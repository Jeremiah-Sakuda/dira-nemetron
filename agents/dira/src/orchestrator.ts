import {
  idempotencyKey,
  type ActionRecord,
  type LedgerApi,
} from '@dira/action-ledger';
import {
  cloneState,
  formatSlackHours,
  isoToMinutes,
  minutesToLabel,
  type DomainState,
} from '@dira/commitment-model';
import {
  applyAction,
  computeFeasibility,
  effectiveWindow,
  rankValidations,
  repairMarginMinutes,
  validatePlan,
  type FeasibilityComputation,
} from '@dira/constraint-engine';
import type {
  ImpactRecord,
  InterpretedMutation,
  PlannedAction,
  RawEmailEvent,
} from '@dira/event-schema';
import { FlightRecorder } from '@dira/observability';
import { evaluateAction, evaluatePlanActions, type PolicyDecision } from '@dira/policy-engine';
import { propagateConsequences } from '@dira/propagation-engine';
import { ToolError, type ToolSet } from '@dira/tool-contracts';
import { interpretEmail, type ModelClient } from './interpreter.js';
import { generateCandidatePlans, type LiveSlot } from './planner.js';

/**
 * Dira orchestrator — the autonomous repair loop (PRD §4, §59).
 *
 *   event → interpret → mutate graph → propagate → feasibility →
 *   plan → validate → policy → ledger → execute → verify → recompute →
 *   RESOLVED | replan | WAITING_REVIEW
 *
 * Internal state is only updated after the verifier confirms external state
 * actually changed. The ledger makes every step crash-resumable: a fresh
 * orchestrator handed the same stores continues instead of duplicating.
 */

export type WorkflowStatus = 'RUNNING' | 'RESOLVED' | 'WAITING_REVIEW' | 'NO_ACTION_NEEDED';

export interface CandidateSummary {
  id: string;
  label: string;
  acceptable: boolean;
  autonomous: boolean;
  costTotal: number;
  slackMinutes: number;
  rejectionReason?: string;
  actionCount: number;
}

export interface WorkflowRun {
  id: string;
  eventId: string;
  status: WorkflowStatus;
  statusReason?: string;
  mutationSummary?: string;
  mutation?: InterpretedMutation;
  slackBeforeMin?: number;
  slackAfterMutationMin?: number;
  slackFinalMin?: number;
  impacts: ImpactRecord[];
  affected: string[];
  planningRounds: CandidateSummary[][];
  selectedPlanIds: string[];
  failuresRecovered: number;
  replans: number;
  userInterventions: number;
}

export interface WorkflowStore {
  get(id: string): Promise<WorkflowRun | undefined>;
  save(run: WorkflowRun): Promise<void>;
}

export class InMemoryWorkflowStore implements WorkflowStore {
  private runs = new Map<string, WorkflowRun>();
  async get(id: string): Promise<WorkflowRun | undefined> {
    const r = this.runs.get(id);
    return r ? structuredClone(r) : undefined;
  }
  async save(run: WorkflowRun): Promise<void> {
    this.runs.set(run.id, structuredClone(run));
  }
}

export interface OrchestratorOptions {
  maxReplans?: number;
  /** Injected backoff; the deterministic replay passes a no-op. */
  sleep?: (ms: number) => Promise<void>;
}

export class DiraOrchestrator {
  private run!: WorkflowRun;

  constructor(
    public state: DomainState,
    private readonly tools: ToolSet,
    private readonly ledger: LedgerApi,
    readonly recorder: FlightRecorder,
    private readonly model: ModelClient,
    private readonly workflows: WorkflowStore = new InMemoryWorkflowStore(),
    private readonly opts: OrchestratorOptions = {},
  ) {}

  private get maxReplans(): number {
    return this.opts.maxReplans ?? 5;
  }

  private label(min: number): string {
    return minutesToLabel(min, this.state.horizonStartIso, this.state.timezone);
  }

  async handleEvent(trigger: RawEmailEvent): Promise<WorkflowRun> {
    const workflowId = `wf-${trigger.eventId}`;
    const existing = await this.workflows.get(workflowId);

    if (existing && existing.status !== 'RUNNING') {
      // Duplicate delivery of a completed workflow: idempotent no-op (PRD §28).
      this.recorder.record('EVENT', `Duplicate event ${trigger.eventId} ignored (workflow ${existing.status})`);
      return existing;
    }

    const persistedMutation = existing?.mutation;
    if (existing && persistedMutation) {
      // A previous worker crashed mid-flight; resume from durable state.
      // Rehydrate the world model: initial state + persisted mutation + every
      // action the verifier already confirmed (and nothing else).
      this.run = existing;
      try {
        this.nowMin = Math.max(0, isoToMinutes(trigger.receivedAtIso, this.state.horizonStartIso));
      } catch {
        this.nowMin = 0;
      }
      this.applyMutation(persistedMutation, trigger);
      for (const record of this.ledger.byWorkflow(workflowId)) {
        if (record.status === 'VERIFIED') {
          this.state = applyAction(this.state, record.action);
        }
      }
      this.recorder.record('EVENT', `Resuming workflow ${workflowId} from persisted state`);
      return this.repairLoop();
    }

    if (existing) {
      // The previous worker died before interpretation completed: nothing has
      // executed (actions only exist after a mutation is stored), so the only
      // safe resume is to restart the workflow from the event itself. A bare
      // "continue" here would compute feasibility on the unmutated state and
      // falsely resolve, permanently swallowing the event.
      this.run = existing;
      this.recorder.record('EVENT', `Restarting workflow ${workflowId}: interpretation never completed`);
    } else {
      this.run = {
        id: workflowId,
        eventId: trigger.eventId,
        status: 'RUNNING',
        impacts: [],
        affected: [],
        planningRounds: [],
        selectedPlanIds: [],
        failuresRecovered: 0,
        replans: 0,
        userInterventions: 0,
      };
      await this.workflows.save(this.run);
    }

    try {
      this.nowMin = Math.max(0, isoToMinutes(trigger.receivedAtIso, this.state.horizonStartIso));
    } catch {
      this.nowMin = 0;
    }

    this.recorder.record('EVENT', `${trigger.source} message received: "${trigger.subject}"`, {
      eventId: trigger.eventId,
      from: trigger.from,
    });

    // ---- INTERPRET (model / fixture; strict schema + entity resolution) ---
    const outcome = await interpretEmail(this.model, trigger, this.state);
    if (!outcome.ok) {
      this.recorder.record('ERROR', `Interpretation failed: ${outcome.failure} (${outcome.detail ?? ''})`);
      return this.finish('WAITING_REVIEW', `interpretation ${outcome.failure}`);
    }
    const interpretation = outcome.result!;
    if (!interpretation.relevant || !interpretation.mutation) {
      this.recorder.record('INTERPRET', `Not a commitment mutation: ${interpretation.reason}`);
      return this.finish('NO_ACTION_NEEDED', interpretation.reason);
    }
    const mutation = interpretation.mutation;
    const target = this.state.commitments[mutation.entity_id]!;
    this.run.mutation = mutation;
    this.run.mutationSummary = summarizeMutation(mutation, target.title);
    const tele = this.model.lastCall;
    const via = tele
      ? ` — ${tele.model} via ${tele.provider}, ${(tele.latencyMs / 1000).toFixed(1)}s`
      : '';
    this.recorder.record('INTERPRET', `${this.run.mutationSummary}${via}`, {
      mutation,
      modelClient: this.model.name,
      modelCall: tele,
      attempts: outcome.attempts,
    });

    // ---- GRAPH: apply the mutation to the commitment graph ----------------
    const before = cloneState(this.state);
    try {
      this.applyMutation(mutation, trigger);
    } catch (err) {
      // An unapplicable mutation must stop safely, never crash the worker.
      this.recorder.record('ERROR', `Mutation could not be applied: ${String(err)}`);
      return this.finish('WAITING_REVIEW', `unapplicable mutation: ${String(err)}`);
    }
    this.recorder.record('GRAPH', `Commitment mutation persisted for "${target.title}"`);

    // ---- PROPAGATE --------------------------------------------------------
    const propagation = propagateConsequences(before, this.state, mutation.entity_id);
    this.run.impacts = propagation.impacts;
    this.run.affected = propagation.affected;
    this.recorder.record(
      'PROPAGATE',
      `${propagation.affected.length} commitments affected via ${propagation.impacts.length} typed-edge impacts`,
      { affected: propagation.affected, impacts: propagation.impacts },
    );

    // ---- FEASIBILITY ------------------------------------------------------
    const beforeF = computeFeasibility(before);
    const afterF = computeFeasibility(this.state);
    this.run.slackBeforeMin = beforeF.global_slack_minutes;
    this.run.slackAfterMutationMin = afterF.global_slack_minutes;
    this.recorder.record(
      'FEASIBILITY',
      `Global slack ${formatSlackHours(beforeF.global_slack_minutes)} → ${formatSlackHours(afterF.global_slack_minutes)}; ` +
        `${afterF.violations.length} violation(s)`,
      { before: beforeF.global_slack_minutes, after: afterF.global_slack_minutes, violations: afterF.violations },
    );

    if (afterF.violations.length === 0 && afterF.global_slack_minutes >= 0) {
      this.run.slackFinalMin = afterF.global_slack_minutes;
      return this.finish('RESOLVED', 'mutation absorbed without repair');
    }

    return this.repairLoop();
  }

  // ---------------------------------------------------------------------- //

  private async repairLoop(): Promise<WorkflowRun> {
    for (;;) {
      const reconciled = await this.reconcileInFlight();
      if (!reconciled) return this.finish('WAITING_REVIEW', 'verification mismatch could not be reconciled');

      const execution = await this.executePending();

      const f = computeFeasibility(this.state);
      if (
        f.violations.length === 0 &&
        f.global_slack_minutes >= 0 &&
        repairMarginMinutes(f) >= this.state.config.repairSlackMarginMin
      ) {
        const pending = this.pendingActions();
        if (pending.length === 0) {
          this.run.slackFinalMin = f.global_slack_minutes;
          this.recorder.record(
            'RESOLVED',
            `Feasibility restored — global slack ${formatSlackHours(f.global_slack_minutes)}`,
            { slack: f.global_slack_minutes },
          );
          return this.finish('RESOLVED');
        }
      }

      if (execution === 'replan') {
        this.recorder.record('REPLAN', 'Re-evaluating remaining repair options against refreshed external state');
      }

      if (this.run.replans >= this.maxReplans) {
        return this.finish('WAITING_REVIEW', 'replan budget exhausted');
      }
      if (this.run.planningRounds.length > 0) this.run.replans += 1;

      const planned = await this.planAndPersist(f);
      if (!planned) {
        return this.finish(
          'WAITING_REVIEW',
          'no policy-compliant feasible repair exists; user decision required',
        );
      }
      await this.workflows.save(this.run);
    }
  }

  /** Verify or fail any actions a previous (crashed) worker left in flight. */
  private async reconcileInFlight(): Promise<boolean> {
    // First, finish any interrupted failure handling: a crash between
    // FAILED_PERMANENT / REPLAN_REQUIRED and plan invalidation must not let
    // this worker execute the remainder of a plan that is already dead.
    const records = this.ledger.byWorkflow(this.run.id);
    const deadPlanIds = new Set(
      records
        .filter((r) => r.status === 'FAILED_PERMANENT' || r.status === 'REPLAN_REQUIRED')
        .map((r) => r.planId)
        .filter((p): p is string => p !== undefined),
    );
    for (const r of records) {
      if (r.status === 'FAILED_PERMANENT') {
        await this.ledger.transition(r.actionId, 'REPLAN_REQUIRED', {}, 'reconciled after restart');
      }
      if (r.status === 'PENDING_EXECUTION' && r.planId !== undefined && deadPlanIds.has(r.planId)) {
        await this.ledger.transition(r.actionId, 'STALE', {}, 'sibling action failed; plan invalidated on resume');
      }
    }

    for (const record of this.ledger.byWorkflow(this.run.id)) {
      if (record.status === 'EXECUTING') {
        const observed = await this.verifyExternal(record.action);
        if (observed.ok) {
          await this.ledger.transition(record.actionId, 'EXECUTED_UNVERIFIED', {}, 'reconciled after restart');
          await this.ledger.transition(record.actionId, 'VERIFIED', {
            verification: { verifiedAtIso: this.recorder.record('VERIFY', `Reconciled: ${record.action.summary}`).atIso, observed: observed.observed },
          });
          this.state = applyAction(this.state, record.action);
        } else {
          await this.ledger.transition(record.actionId, 'FAILED_TRANSIENT', {}, 'in-flight action not observed externally');
          await this.ledger.transition(record.actionId, 'PENDING_EXECUTION', {}, 'retry after restart');
        }
      } else if (record.status === 'EXECUTED_UNVERIFIED') {
        const ok = await this.verifyAndCommit(record);
        if (!ok) return true; // verifyAndCommit routed it to REPLAN_REQUIRED
      }
    }
    return true;
  }

  private pendingActions(): ActionRecord[] {
    return this.ledger
      .byWorkflow(this.run.id)
      .filter((r) => r.status === 'PENDING_EXECUTION' || r.status === 'EXECUTING');
  }

  /**
   * Execute every pending ledger action. Returns 'replan' when a permanent
   * failure or verification mismatch invalidated the current plan.
   */
  private async executePending(): Promise<'ok' | 'replan'> {
    for (;;) {
      const record = await this.ledger.claimNext(this.run.id);
      if (!record) return 'ok';

      this.recorder.record('ACTION', record.action.summary, {
        actionId: record.actionId,
        type: record.action.type,
        attempt: record.attempts,
      });

      // Outbox step 2: does the desired external state already exist?
      const pre = await this.verifyExternal(record.action);
      if (pre.ok) {
        await this.ledger.transition(record.actionId, 'EXECUTED_UNVERIFIED', {
          externalResponse: { alreadySatisfied: true },
        }, 'desired state already present');
        const verified = await this.verifyAndCommit(this.ledger.get(record.actionId)!);
        if (!verified) return 'replan';
        continue;
      }

      try {
        const response = await this.executeExternal(record);
        await this.ledger.transition(record.actionId, 'EXECUTED_UNVERIFIED', {
          externalResponse: response,
        });
      } catch (err) {
        const failure = err instanceof ToolError ? err : new ToolError(String(err), 'UNKNOWN', false);
        this.recorder.record('ERROR', `${record.action.summary} failed: ${failure.message}`, {
          code: failure.code,
          transient: failure.transient,
        });
        if (failure.transient && record.attempts < this.state.config.maxTransientRetries) {
          await this.ledger.transition(record.actionId, 'FAILED_TRANSIENT', { failureReason: failure.message });
          await this.ledger.transition(record.actionId, 'PENDING_EXECUTION', {}, `retry ${record.attempts}`);
          await (this.opts.sleep ?? (() => Promise.resolve()))(2 ** record.attempts * 100);
          continue;
        }
        const terminalPath = failure.transient ? 'FAILED_TRANSIENT' : 'FAILED_PERMANENT';
        if (terminalPath === 'FAILED_TRANSIENT') {
          await this.ledger.transition(record.actionId, 'FAILED_TRANSIENT', { failureReason: failure.message });
          await this.ledger.transition(record.actionId, 'FAILED_PERMANENT', {}, 'retry budget exhausted');
        } else {
          await this.ledger.transition(record.actionId, 'FAILED_PERMANENT', { failureReason: failure.message });
        }
        await this.ledger.transition(record.actionId, 'REPLAN_REQUIRED');
        this.run.failuresRecovered += 1;
        await this.invalidateRemainingPlan();
        this.recorder.record('OBSERVE', 'External state refreshed after failure', {
          failedAction: record.action.summary,
        });
        return 'replan';
      }

      const verified = await this.verifyAndCommit(this.ledger.get(record.actionId)!);
      if (!verified) return 'replan';
    }
  }

  /** Independent verification; on success commit to the internal world model. */
  private async verifyAndCommit(record: ActionRecord): Promise<boolean> {
    const observed = await this.verifyExternal(record.action);
    if (observed.ok) {
      const entry = this.recorder.record('VERIFY', `Verified: ${record.action.summary}`, {
        observed: observed.observed,
      });
      await this.ledger.transition(record.actionId, 'VERIFIED', {
        verification: { verifiedAtIso: entry.atIso, observed: observed.observed },
      });
      this.state = applyAction(this.state, record.action);
      await this.workflows.save(this.run);
      return true;
    }
    this.recorder.record('ERROR', `Verification mismatch for: ${record.action.summary}`, {
      observed: observed.observed,
    });
    await this.ledger.transition(record.actionId, 'REPLAN_REQUIRED', {}, 'external state does not match');
    await this.invalidateRemainingPlan();
    return false;
  }

  private async invalidateRemainingPlan(): Promise<void> {
    for (const r of this.ledger.byWorkflow(this.run.id)) {
      if (r.status === 'PENDING_EXECUTION') {
        await this.ledger.transition(r.actionId, 'STALE', {}, 'plan invalidated');
      }
    }
  }

  // ---------------------------------------------------------------------- //

  private async planAndPersist(f: FeasibilityComputation): Promise<boolean> {
    const liveSlots = await this.refreshLiveSlots();
    const nowMin = this.currentNowMin();

    const candidates = generateCandidatePlans({
      state: this.state,
      feasibility: f,
      liveSlots,
      nowMin,
    });

    const validations = candidates.map((plan) => validatePlan(this.state, plan));
    const policies = validations.map((v) => evaluatePlanActions(this.state, v.plan.actions));

    const summaries: CandidateSummary[] = validations.map((v, i) => ({
      id: v.plan.id,
      label: v.plan.label,
      acceptable: v.acceptable && policies[i]!.autonomous,
      autonomous: policies[i]!.autonomous,
      costTotal: v.cost.total,
      slackMinutes: v.feasibility.global_slack_minutes,
      rejectionReason: !policies[i]!.autonomous
        ? `policy: ${policies[i]!.decisions.find((d) => d.verdict === 'DENY' || d.verdict === 'REQUIRE_APPROVAL')?.reason ?? 'not autonomous'}`
        : v.rejectionReason,
      actionCount: v.plan.actions.length,
    }));
    this.run.planningRounds.push(summaries);
    this.recorder.record('PLAN', `${candidates.length} candidate repair(s) evaluated`, { candidates: summaries });

    const acceptable = rankValidations(validations).filter(
      (v) => v.acceptable && policies[validations.indexOf(v)]!.autonomous,
    );

    // Walk the ranking until a plan is *viable*: every action (including the
    // policy-mandated notifications) must either be new, revivable, or
    // already satisfied. An intent that previously failed permanently can
    // never be re-queued, so a plan re-issuing it would silently lose an
    // action — reject such plans instead of executing them partially.
    for (const chosen of acceptable) {
      const actions = this.expandWithNotifications(chosen.plan.actions);
      if (actions === null) continue; // an action failed the policy re-check

      const roundPlanId = `round${this.run.planningRounds.length}:${chosen.plan.id}`;
      const blocked = actions.find(({ action }) => {
        const existing = this.ledger.findByIdempotencyKey(
          idempotencyKey(this.run.id, action),
        );
        return (
          existing !== undefined &&
          (existing.status === 'REPLAN_REQUIRED' || existing.status === 'FAILED_PERMANENT')
        );
      });
      if (blocked) {
        this.recorder.record(
          'PLAN',
          `Plan ${chosen.plan.id} rejected: "${blocked.action.summary}" already failed permanently`,
        );
        continue;
      }

      this.run.selectedPlanIds.push(chosen.plan.id);
      this.recorder.record(
        'SELECT',
        `Lowest-cost feasible plan selected: ${chosen.plan.label} ` +
          `(cost ${chosen.cost.total}, restored slack ${formatSlackHours(chosen.feasibility.global_slack_minutes)})`,
        { planId: chosen.plan.id, cost: chosen.cost, slack: chosen.feasibility.global_slack_minutes },
      );

      let created = 0;
      let revived = 0;
      for (const [seq, { action, decision }] of actions.entries()) {
        this.recorder.record(
          'POLICY',
          `${decision.verdict}: ${action.summary} [${decision.rule}] · authorized by ${action.provenance.join(', ')}`,
          { verdict: decision.verdict, rule: decision.rule, provenance: action.provenance },
        );
        const { record, created: isNew } = await this.ledger.persistIntent(
          this.run.id,
          action,
          decision.verdict,
          decision.rule,
          { planId: roundPlanId, seq },
        );
        if (isNew) {
          created += 1;
          await this.ledger.transition(record.actionId, 'AUTHORIZED');
          await this.ledger.transition(record.actionId, 'PENDING_EXECUTION');
        } else if (record.status === 'STALE') {
          revived += 1;
          await this.ledger.transition(record.actionId, 'AUTHORIZED', {}, 're-authorized by new plan');
          await this.ledger.transition(record.actionId, 'PENDING_EXECUTION');
        }
      }
      this.recorder.record(
        'LEDGER',
        `${created + revived} action intent(s) persisted to durable ledger` +
          (revived ? ` (${revived} revived from invalidated plan)` : ''),
      );
      return true;
    }
    return false;
  }

  /**
   * Re-check policy per action and append the notifications ALLOW_AND_NOTIFY
   * mandates. Returns null if any action (or mandated notification) is not
   * autonomously executable — defense in depth behind the ranking filter.
   */
  private expandWithNotifications(
    planActions: PlannedAction[],
  ): { action: PlannedAction; decision: PolicyDecision }[] | null {
    const actions: { action: PlannedAction; decision: PolicyDecision }[] = [];
    for (const action of planActions) {
      const decision = evaluateAction(this.state, action);
      if (decision.verdict === 'DENY' || decision.verdict === 'REQUIRE_APPROVAL') return null;
      actions.push({ action, decision });
      if (decision.verdict === 'ALLOW_AND_NOTIFY' && action.type === 'DELEGATE_TASK') {
        const owner = (action.desired_state as { new_owner?: string }).new_owner ?? '';
        const person = this.state.people[owner];
        const task = this.state.commitments[action.target];
        const window = task ? effectiveWindow(this.state, task) : undefined;
        const windowNote = window
          ? ` It needs to happen between ${this.label(window.release)} and ${this.label(window.deadline)}.`
          : '';
        const notify: PlannedAction = {
          type: 'SEND_NOTIFICATION',
          target: owner,
          desired_state: {
            thread_id: `thread-org-${action.target}`,
            to: person?.email ?? owner,
            body:
              `Hi ${person?.name?.split(' ')[0] ?? owner} — a schedule conflict landed on my exam block, ` +
              `so per our backup plan I'm handing you "${task?.title}".${windowNote} Thank you!`,
            body_contains: task?.title ?? action.target,
          },
          provenance: ['user_policy_config:notify-on-delegation'],
          external_system: 'gmail',
          summary: `Notify ${person?.name ?? owner} about the delegation`,
        };
        const notifyDecision = evaluateAction(this.state, notify);
        if (notifyDecision.verdict === 'DENY' || notifyDecision.verdict === 'REQUIRE_APPROVAL') {
          return null; // the mandated notification itself must be executable
        }
        actions.push({ action: notify, decision: notifyDecision });
      }
    }
    return actions;
  }

  private async refreshLiveSlots(): Promise<Record<string, LiveSlot[]>> {
    const result: Record<string, LiveSlot[]> = {};
    for (const [commitmentId, approved] of Object.entries(this.state.approvedSlots)) {
      const listed = await this.tools.recruiter.getAvailableSlots(commitmentId);
      const live: LiveSlot[] = [];
      for (const slot of listed) {
        const startMin = isoToMinutes(slot.startIso, this.state.horizonStartIso);
        const match = approved.find((a) => a.startMin === startMin);
        if (match) {
          live.push({
            slotId: slot.slotId,
            startMin,
            durationMin: match.durationMin,
            provenance: match.provenance,
          });
        }
      }
      result[commitmentId] = live;
    }
    return result;
  }

  /** Planning "now": the trigger's arrival, projected onto the horizon. */
  private nowMin = 0;
  private currentNowMin(): number {
    return this.nowMin;
  }

  // ---------------------------------------------------------------------- //

  private applyMutation(mutation: InterpretedMutation, trigger: RawEmailEvent): void {
    const c = this.state.commitments[mutation.entity_id]!;
    switch (mutation.mutation_type) {
      case 'schedule_change': {
        if (!mutation.new_start) throw new Error('schedule_change without new_start');
        c.startMin = isoToMinutes(mutation.new_start, this.state.horizonStartIso);
        break;
      }
      case 'deadline_change': {
        if (!mutation.new_start) throw new Error('deadline_change without new_start');
        c.deadlineMin = isoToMinutes(mutation.new_start, this.state.horizonStartIso);
        break;
      }
      case 'offer_of_alternatives': {
        // The counterpart withdrew the current time and offered alternatives:
        // the commitment is unscheduled until Dira books one of them.
        c.startMin = undefined;
        this.state.approvedSlots[c.id] = (mutation.offered_alternatives ?? []).map((isoStr) => ({
          startMin: isoToMinutes(isoStr, this.state.horizonStartIso),
          durationMin: c.durationMin ?? 60,
          provenance: trigger.threadId,
        }));
        break;
      }
      case 'cancellation':
        c.status = 'DROPPED';
        break;
      case 'new_commitment':
      case 'unrelated':
        break;
      default:
        break;
    }
    c.updatedAtIso = trigger.receivedAtIso;
  }

  private externalId(action: PlannedAction): string {
    const c = this.state.commitments[action.target];
    return c?.externalId ?? `cal-${action.target}`;
  }

  private async executeExternal(record: ActionRecord): Promise<unknown> {
    const action = record.action;
    const d = action.desired_state as Record<string, string | number | undefined>;
    switch (action.type) {
      case 'BOOK_INTERVIEW_SLOT':
        return this.tools.recruiter.bookSlot(
          action.target,
          String(d.slot_id),
          record.idempotencyKey,
        );
      case 'MOVE_CALENDAR_EVENT':
        await this.tools.calendar.moveEvent(
          this.externalId(action),
          String(d.start_iso),
          String(d.end_iso),
        );
        return { moved: true };
      case 'CREATE_CALENDAR_EVENT':
        return this.tools.calendar.createEvent({
          id: `cal-${action.target}`,
          title: String(d.title),
          startIso: String(d.start_iso),
          endIso: String(d.end_iso),
        });
      case 'DELETE_CALENDAR_EVENT':
        await this.tools.calendar.deleteEvent(this.externalId(action));
        return { deleted: true };
      case 'DELEGATE_TASK': {
        const c = this.state.commitments[action.target];
        await this.tools.org.updateOwner(c?.externalId ?? action.target, String(d.new_owner));
        return { delegated: true };
      }
      case 'SEND_NOTIFICATION':
        return this.tools.gmail.sendReply(String(d.thread_id), String(d.to), String(d.body));
      case 'DECLINE_INTERVIEW':
        throw new ToolError('declining an interview is never autonomous', 'POLICY', false);
      default:
        throw new ToolError(`unsupported action ${action.type}`, 'UNSUPPORTED', false);
    }
  }

  private async verifyExternal(
    action: PlannedAction,
  ): Promise<{ ok: boolean; observed: unknown }> {
    const d = action.desired_state as Record<string, string | number | undefined>;
    switch (action.type) {
      case 'BOOK_INTERVIEW_SLOT': {
        const booking = await this.tools.recruiter.verifyBooking(action.target);
        return { ok: booking?.startIso === d.start_iso, observed: booking };
      }
      case 'MOVE_CALENDAR_EVENT': {
        const ev = await this.tools.calendar.verifyEvent({
          id: this.externalId(action),
          startIso: String(d.start_iso),
        });
        return { ok: ev !== null, observed: ev };
      }
      case 'CREATE_CALENDAR_EVENT': {
        const ev = await this.tools.calendar.verifyEvent({
          id: `cal-${action.target}`,
          startIso: String(d.start_iso),
        });
        return { ok: ev !== null, observed: ev };
      }
      case 'DELETE_CALENDAR_EVENT': {
        const ev = await this.tools.calendar.verifyEvent({ id: this.externalId(action) });
        return { ok: ev === null, observed: ev };
      }
      case 'DELEGATE_TASK': {
        const c = this.state.commitments[action.target];
        const assignment = await this.tools.org.verifyAssignment(c?.externalId ?? action.target);
        return { ok: assignment?.owner === d.new_owner, observed: assignment };
      }
      case 'SEND_NOTIFICATION': {
        const ok = await this.tools.gmail.verifyReply(
          String(d.thread_id),
          String(d.body_contains ?? ''),
        );
        return { ok, observed: { sent: ok } };
      }
      default:
        return { ok: false, observed: null };
    }
  }

  private async finish(status: WorkflowStatus, reason?: string): Promise<WorkflowRun> {
    this.run.status = status;
    this.run.statusReason = reason;
    if (status === 'WAITING_REVIEW') {
      this.recorder.record('WAITING_REVIEW', reason ?? 'user decision required');
    }
    await this.workflows.save(this.run);
    return structuredClone(this.run);
  }
}

function summarizeMutation(m: InterpretedMutation, title: string): string {
  switch (m.mutation_type) {
    case 'schedule_change':
      return `"${title}" moved ${m.old_start ?? '?'} → ${m.new_start ?? '?'}`;
    case 'offer_of_alternatives':
      return `"${title}" withdrawn; ${m.offered_alternatives?.length ?? 0} alternatives offered`;
    case 'deadline_change':
      return `"${title}" deadline changed to ${m.new_start ?? '?'}`;
    case 'cancellation':
      return `"${title}" cancelled`;
    default:
      return `"${title}" ${m.mutation_type}`;
  }
}

/** Deterministic 1-second logical clock for reproducible flight recordings. */
export function makeReplayClock(startIso: string): () => string {
  let t = Date.parse(startIso);
  return () => {
    t += 1000;
    return new Date(t).toISOString();
  };
}

export interface RunMetrics {
  verifiedExternalMutations: number;
  distinctExternalSystems: number;
  /** Permanent tool failures the run worked around — counted as *recovered*
   * only when the workflow actually reached RESOLVED. */
  failuresRecovered: number;
  /** Permanent tool failures observed, regardless of the final status. */
  failuresEncountered: number;
  policyViolations: number;
  userInterventions: number;
  finalSlackMin: number | undefined;
  status: WorkflowStatus;
}

export function computeRunMetrics(run: WorkflowRun, ledger: LedgerApi): RunMetrics {
  const verified = ledger.byWorkflow(run.id).filter((r) => r.status === 'VERIFIED');
  return {
    verifiedExternalMutations: verified.length,
    distinctExternalSystems: new Set(verified.map((r) => r.action.external_system)).size,
    failuresRecovered: run.status === 'RESOLVED' ? run.failuresRecovered : 0,
    failuresEncountered: run.failuresRecovered,
    policyViolations: ledger
      .byWorkflow(run.id)
      .filter((r) => r.policyVerdict === 'DENY' || r.policyVerdict === 'REQUIRE_APPROVAL').length,
    userInterventions: run.userInterventions,
    finalSlackMin: run.slackFinalMin,
    status: run.status,
  };
}

/** One externally-visible change a run produced, for a judge-facing before/after. */
export interface SurfaceChange {
  surface: string;
  before: string;
  after: string;
  verification: string;
}

function ownerName(state: DomainState, ownerId: string): string {
  const fromPeople = state.people[ownerId]?.name?.split(' ')[0];
  if (fromPeople) return fromPeople;
  const bare = ownerId.replace(/^user-/, '');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

function verificationFor(system: string | undefined): string {
  switch (system) {
    case 'organization': return 'Org tracker re-read';
    case 'recruiter': return 'Recruiter + calendar re-read';
    case 'gmail': return 'Outbox re-read';
    default: return 'Calendar re-read';
  }
}

/**
 * Diff the world before and after a run into a compact, judge-facing table
 * (PRD §48 auditability): what each external surface was, what it became, and
 * how the change was independently verified. Reservations are collapsed into
 * a single "study plan" row.
 */
export function summarizeSurfaceChanges(before: DomainState, after: DomainState): SurfaceChange[] {
  const label = (min: number | undefined) =>
    min === undefined ? 'unscheduled' : minutesToLabel(min, before.horizonStartIso, before.timezone);
  const changes: SurfaceChange[] = [];

  for (const [id, b] of Object.entries(before.commitments)) {
    if (b.reservesEffortFor) continue;
    const a = after.commitments[id];
    if (!a) continue;
    if (b.kind !== 'effort' && b.startMin !== a.startMin) {
      changes.push({ surface: b.title, before: label(b.startMin), after: label(a.startMin), verification: verificationFor(b.externalSystem) });
    } else if (b.owner !== a.owner) {
      changes.push({ surface: b.title, before: ownerName(before, b.owner), after: ownerName(after, a.owner), verification: verificationFor(b.externalSystem) });
    } else if (b.status !== a.status && a.status === 'DROPPED') {
      changes.push({ surface: b.title, before: 'scheduled', after: 'dropped', verification: verificationFor(b.externalSystem) });
    }
  }

  // Study-plan reservations collapse into one row when any prep block moved.
  const resKey = (s: DomainState) =>
    Object.values(s.commitments)
      .filter((c) => c.reservesEffortFor && c.status !== 'DROPPED')
      .map((c) => c.startMin)
      .sort((x, y) => (x ?? 0) - (y ?? 0))
      .join(',');
  const beforeCount = Object.values(before.commitments).filter((c) => c.reservesEffortFor && c.status !== 'DROPPED').length;
  const afterCount = Object.values(after.commitments).filter((c) => c.reservesEffortFor && c.status !== 'DROPPED').length;
  if (resKey(before) !== resKey(after)) {
    changes.push({
      surface: 'Study plan',
      before: `${beforeCount} prep block${beforeCount === 1 ? '' : 's'}`,
      after: `${afterCount} block${afterCount === 1 ? '' : 's'} rebuilt before the exam`,
      verification: 'Calendar re-read',
    });
  }
  return changes;
}

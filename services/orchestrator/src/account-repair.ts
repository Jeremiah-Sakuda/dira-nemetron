import { ActionLedger, type ActionRecord } from '@dira/action-ledger';
import {
  DiraOrchestrator,
  FixtureModelClient,
  FixtureRepairModel,
  NemotronModelClient,
  UltraRepairProposer,
  type ModelClient,
  type RepairProposalInput,
  type RepairProposalOutcome,
  type WorkflowRun,
  type WorkflowStore,
} from '@dira/agent';
import { isoToMinutes, type DomainState } from '@dira/commitment-model';
import { applyRulesToPlanningState, evaluateAction } from '@dira/policy-engine';
import type { InterpretationResult, RawEmailEvent } from '@dira/event-schema';
import { FlightRecorder, type FlightEntry } from '@dira/observability';
import type { ToolSet } from '@dira/tool-contracts';
import { assertRemainingCalendarPlanFresh } from './calendar-resume.js';
import { availabilityIntervals, rebaseDomainState } from './account-planning.js';
import { appendFlightRecords, getAccountKind, recordEgressAttempt } from './account-records.js';
import { accountToolLabels, buildAccountToolSet, type AccountKind, type AccountToolLabels } from './account-tools.js';
import { buildDemoWorldAt, DEMO_STORED_THREADS } from './demo-world.js';
import { withEgressContext } from './egress-guard.js';
import { googleAccessToken } from './google-auth.js';
import { PostgresLedgerStore, PostgresWorkflowStore, type PostgresAccountStore } from './postgres-store.js';

/**
 * Event-driven repair for personal accounts and the demo persona.
 *
 *   untrusted email → Super interpretation + deterministic gates → graph
 *   mutation → propagation → feasibility → deterministic + Ultra candidates →
 *   validation → policy → ledger → (owner approval) → per-account tools →
 *   independent read-back → graph commit
 *
 * Runs are serialized per account. State is persisted after the mutation and
 * after every verified action, and every flight-record line is stored.
 */

export class AccountBusyError extends Error {
  override name = 'AccountBusyError';
}

export interface AccountRepairOptions {
  /** Test/eval override for the interpreter. */
  model?: ModelClient;
  /** Test/eval override for the repair proposer; null disables it. */
  proposer?: { propose(input: RepairProposalInput): Promise<RepairProposalOutcome> } | null;
  /** Demo only: add the labeled adversarial proposal. */
  adversarialProbe?: boolean;
  /** Called when a run pauses for approval (Telegram buttons, for example). */
  onAwaitingApproval?: (run: WorkflowRun, pending: ActionRecord[]) => Promise<void>;
  now?: () => Date;
  tokenForAccount?: (store: PostgresAccountStore, accountId: string) => Promise<string>;
}

export interface AccountRepairResult {
  run: WorkflowRun;
  flight: FlightEntry[];
  labels: AccountToolLabels;
  modelMode: 'live' | 'fixture';
}

export function liveModelConfigured(): boolean {
  return Boolean(process.env.NEBIUS_API_KEY);
}

export async function handleAccountEmail(
  store: PostgresAccountStore,
  accountId: string,
  email: RawEmailEvent,
  options: AccountRepairOptions = {},
): Promise<AccountRepairResult> {
  const locked = await store.withAdvisoryJobLock(accountId, 'event-repair', async () => {
    const runtime = await prepareRuntime(store, accountId, options);
    const existing = await runtime.workflows.get(`wf-${email.eventId}`);
    if (existing && existing.status !== 'RUNNING') {
      return { run: existing, flight: [], labels: runtime.labels, modelMode: runtime.modelMode };
    }
    const model = options.model ?? runtime.defaultModel(email);
    const orchestrator = runtime.orchestrator(model, email.receivedAtIso);
    const run = await runtime.withScope('event-repair', () => orchestrator.handleEvent(email));
    await runtime.flush(run.id);
    await afterRun(store, accountId, runtime, run, options);
    return { run, flight: runtime.recorder.all(), labels: runtime.labels, modelMode: runtime.modelMode };
  });
  if (!locked.acquired) throw new AccountBusyError('Dira is already working on this account; try again in a moment.');
  return locked.value;
}

/** Continue a paused workflow after owner decisions. Re-reads the touched calendar items first. */
export async function resumeAccountRepair(
  store: PostgresAccountStore,
  accountId: string,
  workflowId: string,
  options: AccountRepairOptions = {},
): Promise<AccountRepairResult> {
  const locked = await store.withAdvisoryJobLock(accountId, 'event-repair', async () => {
    const runtime = await prepareRuntime(store, accountId, options);
    const run = await runtime.workflows.get(workflowId);
    if (!run || run.kind !== 'event-repair') throw new Error('event repair workflow not found');
    const records = runtime.ledger.byWorkflow(workflowId);
    await refreshExternalTruth(runtime, records);
    const clockIso = runtime.kind === 'demo' && run.clockIso ? run.clockIso : runtime.now().toISOString();
    const orchestrator = runtime.orchestrator(
      options.model ?? new FixtureModelClient({}), clockIso,
    );
    const resumed = await runtime.withScope('approval-resume', () => orchestrator.resumeAfterApproval(workflowId, clockIso));
    await runtime.flush(workflowId);
    await afterRun(store, accountId, runtime, resumed, options);
    return { run: resumed, flight: runtime.recorder.all(), labels: runtime.labels, modelMode: runtime.modelMode };
  });
  if (!locked.acquired) throw new AccountBusyError('Dira is already working on this account; try again in a moment.');
  return locked.value;
}

/**
 * A change the owner described in chat and then confirmed in the web app.
 * It is interpreted like an email from the owner and may only change the
 * owner's own commitments; third-party commitments still need their sender.
 */
export async function handleOwnerNote(
  store: PostgresAccountStore,
  accountId: string,
  note: { noteId: string; text: string },
  options: AccountRepairOptions = {},
): Promise<AccountRepairResult> {
  const [account, state] = await Promise.all([store.getAccount(accountId), store.loadDomainState(accountId)]);
  if (!account || !state) throw new Error('account is not initialized');
  const ownerEmail = (state.people[state.userId]?.email ?? account.email).toLowerCase();
  if (!state.people[state.userId]) {
    state.people[state.userId] = { id: state.userId, name: account.email.split('@')[0] ?? 'Owner', email: ownerEmail };
    await store.saveDomainState(accountId, state);
  }
  const now = (options.now ?? (() => new Date()))();
  return handleAccountEmail(store, accountId, {
    eventId: `evt-${note.noteId}`,
    source: 'user_note',
    threadId: `thread-${note.noteId}`,
    messageId: note.noteId,
    from: ownerEmail,
    to: ownerEmail,
    subject: 'Change relayed by the owner',
    body: note.text,
    receivedAtIso: now.toISOString(),
  }, options);
}

/** Plan again (after a rejection and a confirmed rule, for example). */
export async function replanAccountRepair(
  store: PostgresAccountStore,
  accountId: string,
  workflowId: string,
  options: AccountRepairOptions = {},
): Promise<AccountRepairResult> {
  const locked = await store.withAdvisoryJobLock(accountId, 'event-repair', async () => {
    const runtime = await prepareRuntime(store, accountId, options);
    const run = await runtime.workflows.get(workflowId);
    if (!run || run.kind !== 'event-repair') throw new Error('event repair workflow not found');
    const clockIso = runtime.kind === 'demo' && run.clockIso ? run.clockIso : runtime.now().toISOString();
    const orchestrator = runtime.orchestrator(new FixtureModelClient({}), clockIso);
    const replanned = await runtime.withScope('owner-replan', () => orchestrator.replanWorkflow(workflowId, clockIso));
    await runtime.flush(workflowId);
    await afterRun(store, accountId, runtime, replanned, options);
    return { run: replanned, flight: runtime.recorder.all(), labels: runtime.labels, modelMode: runtime.modelMode };
  });
  if (!locked.acquired) throw new AccountBusyError('Dira is already working on this account; try again in a moment.');
  return locked.value;
}

/** Workflows awaiting approval whose gated actions all have owner decisions. */
export async function workflowReadyToResume(store: PostgresAccountStore, accountId: string, workflowId: string): Promise<boolean> {
  const records = await store.listWorkflowActionRecords(accountId, workflowId);
  const gated = records.filter((record) => record.policyVerdict === 'REQUIRE_APPROVAL');
  return gated.length > 0 && gated.every((record) => record.status !== 'AWAITING_APPROVAL');
}

async function afterRun(
  store: PostgresAccountStore,
  accountId: string,
  runtime: Awaited<ReturnType<typeof prepareRuntime>>,
  run: WorkflowRun,
  options: AccountRepairOptions,
): Promise<void> {
  // Surface every deterministic rejection on the Policies page as well.
  for (const entry of runtime.recorder.all()) {
    if (entry.phase !== 'REJECT') continue;
    const data = entry.data as { stage?: string; label?: string; source?: string; reasons?: string[] } | undefined;
    await store.recordPolicyBlock(accountId, {
      actionType: data?.source === 'adversarial-probe' ? 'ADVERSARIAL_PROPOSAL' : 'MODEL_PROPOSAL',
      targetId: (data?.label ?? 'proposal').slice(0, 200),
      policyRule: `proposal-${data?.stage ?? 'rejected'}`,
      reason: (data?.reasons ?? [entry.message]).join('; ').slice(0, 480),
    });
  }
  const blocked = runtime.recorder.all().find((entry) => entry.phase === 'ERROR' && entry.message.includes('UNVERIFIED_SENDER'));
  if (blocked) {
    await store.recordPolicyBlock(accountId, {
      actionType: 'APPLY_EMAIL_MUTATION', targetId: run.eventId.slice(0, 200), policyRule: 'sender-authority',
      reason: blocked.message.slice(0, 480),
    });
  }
  if (run.status === 'AWAITING_APPROVAL' && options.onAwaitingApproval) {
    const pending = runtime.ledger.byWorkflow(run.id).filter((record) => record.status === 'AWAITING_APPROVAL');
    await options.onAwaitingApproval(run, pending).catch((error) => console.error('approval notification failed', error));
  }
}

async function refreshExternalTruth(runtime: Awaited<ReturnType<typeof prepareRuntime>>, records: ActionRecord[]): Promise<void> {
  const state = runtime.state();
  const targets = new Set(records
    .filter((record) => record.status === 'AUTHORIZED' || record.status === 'AWAITING_APPROVAL')
    .map((record) => record.action.target));
  for (const id of targets) {
    const commitment = state.commitments[id];
    if (!commitment || commitment.externalSystem !== 'calendar' || commitment.startMin === undefined) continue;
    const eventId = commitment.externalId ?? `cal-${id}`;
    const event = await runtime.tools.calendar.verifyEvent({ id: eventId });
    runtime.recorder.record('OBSERVE', event
      ? `Fresh read before resume: "${commitment.title}" at ${event.startIso}`
      : `Fresh read before resume: "${commitment.title}" is no longer on the calendar`);
    if (!event) {
      commitment.status = 'DROPPED';
      continue;
    }
    const startMin = isoToMinutes(new Date(Date.parse(event.startIso)).toISOString(), state.horizonStartIso);
    const endMin = isoToMinutes(new Date(Date.parse(event.endIso)).toISOString(), state.horizonStartIso);
    commitment.startMin = startMin;
    commitment.durationMin = endMin - startMin;
  }
}

async function prepareRuntime(store: PostgresAccountStore, accountId: string, options: AccountRepairOptions) {
  const now = options.now ?? (() => new Date());
  const [account, kind, policy, profile, stored] = await Promise.all([
    store.getAccount(accountId),
    getAccountKind(store, accountId),
    store.getAccountPolicySettings(accountId),
    store.getAvailabilityProfile(accountId),
    store.loadDomainState(accountId),
  ]);
  if (!account || !kind || !stored) throw new Error('account is not initialized');
  if (kind === 'google' && !profile) throw new Error('Set your focus hours before Dira can repair your schedule.');

  // Real accounts plan from the current moment with focus hours expanded;
  // the demo world keeps its synthetic week and seeded focus windows.
  let current: DomainState = stored;
  if (kind === 'google') {
    current = rebaseDomainState(stored, now());
    current.availability = availabilityIntervals(profile!, current, now());
  }
  // Confirmed correction rules shape the planning view only; the stored
  // focus windows are restored on every save.
  const storedAvailability = stored.availability;
  current = applyRulesToPlanningState(current, policy.correctionRules);
  const state = () => current;
  const credential = kind === 'google' ? await store.getCredential(accountId, 'google') : undefined;
  const tokenFor = options.tokenForAccount ?? googleAccessToken;
  const tools: ToolSet = buildAccountToolSet({
    store, accountId, kind,
    state,
    draftOnly: async () => (await store.getAccountPolicySettings(accountId)).draftOnly,
    ownerEmail: kind === 'demo' ? (current.people[current.userId]?.email ?? account.email) : account.email,
    ...(kind === 'google' ? {
      google: {
        accessToken: () => tokenFor(store, accountId),
        scopes: async () => (await store.getCredential(accountId, 'google'))?.scopes ?? credential?.scopes ?? [],
        calendarFenced: async () => (await store.getAccountPolicySettings(accountId)).fencedCalendarIds.includes('primary'),
      },
    } : {}),
  });
  const ledger = await ActionLedger.open(new PostgresLedgerStore(store, accountId));
  const recorder = new FlightRecorder();
  const pendingWrites: FlightEntry[] = [];
  recorder.onEntry((entry) => { pendingWrites.push(entry); });
  const labels = accountToolLabels(kind);
  const live = liveModelConfigured();
  const demoWorld = kind === 'demo' ? buildDemoWorldAt(accountId, stored.horizonStartIso) : undefined;
  const modelMode: 'live' | 'fixture' = live ? 'live' : 'fixture';

  const proposer = options.proposer === null ? undefined
    : options.proposer ?? (live
      ? new UltraRepairProposer()
      : demoWorld ? new UltraRepairProposer(new FixtureRepairModel(demoWorld.fixtureRepairProposal)) : undefined);
  const facts = {
    messageIds: demoWorld ? demoWorld.inboxSeed.map((message) => message.messageId) : [],
    threadIds: demoWorld ? [...DEMO_STORED_THREADS] : Object.values(current.approvedSlots).flat().map((slot) => slot.provenance),
  };

  let workflowId: string | undefined;
  const flush = async (id: string) => {
    workflowId = id;
    const batch = pendingWrites.splice(0, pendingWrites.length);
    await appendFlightRecords(store, accountId, id, batch);
  };

  const workflows: WorkflowStore = new TaggedWorkflowStore(new PostgresWorkflowStore(store, accountId), 'event-repair');

  return {
    kind: kind as AccountKind,
    labels,
    modelMode,
    tools,
    ledger,
    recorder,
    workflows,
    now,
    state,
    flush,
    defaultModel(email: RawEmailEvent): ModelClient {
      if (live) return new NemotronModelClient();
      if (demoWorld) {
        const stored: Record<string, InterpretationResult> = {};
        for (const preset of demoWorld.presets) stored[preset.email.messageId] = preset.interpretation;
        return new FixtureModelClient(stored);
      }
      void email;
      throw new Error('Nemotron interpretation is not configured on this deployment (NEBIUS_API_KEY).');
    },
    orchestrator(model: ModelClient, clockIso: string) {
      return new DiraOrchestrator(current, tools, ledger, recorder, model, new ClockedWorkflowStore(workflows, clockIso), {
        approvals: true,
        ...(kind === 'google' ? {
          executionClock:now,
          beforeExternalAction:async (_record:ActionRecord,remaining:ActionRecord[],fresh:DomainState) => {
            const [latestPolicy,latestProfile]=await Promise.all([store.getAccountPolicySettings(accountId),store.getAvailabilityProfile(accountId)]);
            if (!latestProfile) throw new Error('Focus hours are unavailable; request a fresh plan');
            for(const item of remaining) {
              const decision=evaluateAction(fresh,item.action,latestPolicy.requireApproval,latestPolicy.correctionRules);
              if (decision.verdict !== item.policyVerdict || decision.rule !== item.policyRule || decision.verdict === 'DENY') throw new Error('Policy changed; request a fresh plan');
            }
            assertRemainingCalendarPlanFresh(fresh,latestProfile,remaining,latestPolicy,now());
          },
        } : {}),
        policyOverrides: policy.requireApproval,
        correctionRules: policy.correctionRules,
        approvalSources: ['authenticated-web', 'telegram-callback'],
        repairProposer: proposer,
        adversarialProbe: kind === 'demo' && options.adversarialProbe === true,
        facts,
        onStateCommitted: async (next) => {
          current = next;
          const persisted = structuredClone(next);
          persisted.availability = kind === 'google' ? [] : storedAvailability;
          delete persisted.avoidWindows;
          await store.saveDomainState(accountId, persisted);
          if (workflowId) await flush(workflowId);
        },
      });
    },
    withScope<T>(purpose: string, operation: () => Promise<T>): Promise<T> {
      return withEgressContext({
        accountId,
        purpose,
        onDecision: async (decision) => {
          recorder.record('ERROR', `Egress blocked: ${decision.host} → HTTP ${decision.statusCode} (${decision.purpose})`, decision);
          await recordEgressAttempt(store, accountId, decision);
        },
      }, operation);
    },
  };
}

/** Tag every saved run as an event-repair workflow so approvals route to this engine. */
class TaggedWorkflowStore implements WorkflowStore {
  constructor(private readonly inner: WorkflowStore, private readonly kind: WorkflowRun['kind']) {}
  get(id: string) { return this.inner.get(id); }
  save(run: WorkflowRun) { return this.inner.save({ ...run, kind: run.kind ?? this.kind }); }
}

/** Persist the planning clock with the run (the synthetic trigger time for demo worlds). */
class ClockedWorkflowStore implements WorkflowStore {
  constructor(private readonly inner: WorkflowStore, private readonly clockIso: string) {}
  get(id: string) { return this.inner.get(id); }
  save(run: WorkflowRun) { return this.inner.save({ ...run, clockIso: run.clockIso ?? this.clockIso }); }
}

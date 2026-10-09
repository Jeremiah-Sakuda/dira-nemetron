import { ActionLedger, type ActionRecord } from '@dira/action-ledger';
import { isoToMinutes, type Commitment, type DomainState } from '@dira/commitment-model';
import { GoogleUserCalendarTool } from '@dira/adapter-calendar/user-google';
import { evaluateAction } from '@dira/policy-engine';
import { ToolError, type CalendarEvent } from '@dira/tool-contracts';
import { calendarIsoToMinutes, revalidateAccountApproval } from './account-approval.js';
import {
  PostgresLedgerStore,
  PostgresWorkflowStore,
  type ApprovalRevalidationEvidence,
  type PostgresAccountStore,
} from './postgres-store.js';
import type { WorkflowRun } from '@dira/agent';

export interface AccountWorkflowResumeResult {
  status: 'RESOLVED' | 'WAITING_REVIEW';
  workflowId: string;
  verifiedActions: number;
  reason?: string;
}

/**
 * Resume an approved account plan through the out-of-model broker. The whole
 * operation is serialized per account/workflow; every action is rechecked
 * against deterministic policy, executed through a narrow Calendar adapter,
 * independently verified, and only then written back to the graph.
 */
export async function resumeApprovedAccountWorkflow(
  store: PostgresAccountStore,
  accountId: string,
  workflowId: string,
  getAccessToken: () => Promise<string>,
): Promise<AccountWorkflowResumeResult> {
  try {
    const result = await store.withWorkflowExecutionLock<AccountWorkflowResumeResult>(accountId, workflowId, async (executionClient) => {
    const workflowStore = new PostgresWorkflowStore(store, accountId);
    const run = await workflowStore.get(workflowId);
    if (!run) throw new Error('workflow not found');
    let records = await store.listWorkflowActionRecords(accountId, workflowId);
    if (!records.length) throw new Error('workflow has no actions');
    if (run.status === 'RESOLVED' && records.every((record) => record.status === 'VERIFIED')) {
      return { status: 'RESOLVED', workflowId, verifiedActions: records.length };
    }
    if (records.some((record) => ['AWAITING_APPROVAL', 'REJECTED', 'STALE', 'REPLAN_REQUIRED', 'FAILED_PERMANENT'].includes(record.status))) {
      return waitForReview(workflowStore, run, workflowId, records.filter((record) => record.status !== 'VERIFIED').length,
        'The plan contains an action that is not authorized for execution.');
    }

    let evidence = await store.getWorkflowExecutionEvidence(accountId, workflowId);
    const noActionStarted = records.every((record) => ['AUTHORIZED', 'PENDING_EXECUTION'].includes(record.status));
    if (!evidence || noActionStarted) {
      const approvalRecord = records.find((record) => record.policyVerdict === 'REQUIRE_APPROVAL');
      if (!approvalRecord || records.some((record) => record.status !== 'AUTHORIZED')) {
        return waitForReview(workflowStore, run, workflowId, 0, 'Every plan action must be authorized before it can resume.');
      }
      const revalidation = await revalidateAccountApproval(store, accountId, approvalRecord.actionId, getAccessToken, 'resume');
      if (!revalidation.ok) {
        if (!revalidation.retryable) {
          await store.invalidateWorkflowActionsForReplan(accountId, workflowId, revalidation.reason);
        }
        return waitForReview(workflowStore, run, workflowId, 0, revalidation.reason);
      }
      // Commit the resume evidence before any external mutation. The outer
      // workflow transaction still holds the state/profile and advisory locks.
      await store.recordWorkflowExecutionEvidence(accountId, workflowId, revalidation.evidence);
      evidence = revalidation.evidence;
    }

    const credential = await store.getCredential(accountId, 'google');
    const writeGranted = credential?.scopes.includes('https://www.googleapis.com/auth/calendar.events') ?? false;
    const ledger = await ActionLedger.open(new PostgresLedgerStore(store, accountId));
    const calendar = new GoogleUserCalendarTool(getAccessToken, async () => writeGranted);
    const snapshot = await store.loadAccountPlanningSnapshot(accountId);
    if (!snapshot) return waitForReview(workflowStore, run, workflowId, records.length, 'The account graph is unavailable.');
    for (const record of records.filter((item) => ['EXECUTING', 'EXECUTED_UNVERIFIED'].includes(item.status))) {
      const fresh = await verifyCalendarAction(calendar, snapshot.state, record);
      if (fresh.ok) {
        let recovered = ledger.get(record.actionId)!;
        if (recovered.status === 'EXECUTING') {
          recovered = await ledger.transition(recovered.actionId, 'EXECUTED_UNVERIFIED', {
            externalResponse: fresh.observed,
          }, 'recovered uncertain Calendar write by fresh read');
        }
        await ledger.transition(recovered.actionId, 'VERIFIED', {
          verification: { verifiedAtIso: new Date().toISOString(), observed: fresh.observed },
        }, 'fresh Calendar read confirms the interrupted action');
      }
    }
    records = await store.listWorkflowActionRecords(accountId, workflowId);
    if (snapshot && records.every((record) => record.status === 'VERIFIED')
      && graphReflectsVerifiedActions(snapshot.state, records)) {
      return { status: 'RESOLVED', workflowId, verifiedActions: records.length };
    }
    if (snapshot.stateVersion !== evidence.stateVersion
      || (snapshot.profileVersion !== evidence.profileVersion && !records.every((record) => record.status === 'VERIFIED'))) {
      const reason = 'The account graph or focus hours changed after revalidation. Request a fresh plan.';
      await store.invalidateWorkflowActionsForReplan(accountId, workflowId, reason);
      return waitForReview(workflowStore, run, workflowId, records.length, reason);
    }
    if (!records.every((record) => record.status === 'VERIFIED') && !writeGranted) {
      return waitForReview(workflowStore, run, workflowId, records.length,
        'Grant Google Calendar event access in Account setup before resuming this plan.');
    }
    for (const record of records) {
      const decision = evaluateAction(snapshot.state, record.action, snapshot.policy.requireApproval);
      if (decision.verdict !== record.policyVerdict || decision.rule !== record.policyRule) {
        return waitForReview(workflowStore, run, workflowId, records.length,
          `Policy changed for “${record.action.summary}”. Request a fresh plan.`);
      }
      if (decision.verdict === 'DENY') {
        return waitForReview(workflowStore, run, workflowId, records.length,
          `Policy denied “${record.action.summary}”: ${decision.reason}`);
      }
      if (decision.verdict === 'REQUIRE_APPROVAL'
        && (record.approval?.decision !== 'APPROVED'
          || record.approval.actorAccountId !== accountId
          || record.approval.source !== 'authenticated-web')) {
        return waitForReview(workflowStore, run, workflowId, records.length,
          'The action has no authenticated account-owner approval.');
      }
      if (record.action.external_system !== 'calendar'
        || !['CREATE_CALENDAR_EVENT', 'MOVE_CALENDAR_EVENT', 'DELETE_CALENDAR_EVENT'].includes(record.action.type)) {
        return waitForReview(workflowStore, run, workflowId, records.length,
          `The account broker does not support ${record.action.type} yet.`);
      }
    }

    run.status = 'RUNNING';
    run.statusReason = 'Fresh-state and deterministic policy checks passed; executing through the Calendar broker.';
    await workflowStore.save(run);

    for (const initial of [...records].sort((left, right) => (left.planSeq ?? 0) - (right.planSeq ?? 0))) {
      let record = ledger.get(initial.actionId);
      if (!record || record.status === 'VERIFIED') continue;
      try {
        const preflight = await inspectCalendarAction(calendar, snapshot.state, record);
        if (preflight.alreadyApplied) {
          if (record.status === 'AUTHORIZED' || record.status === 'FAILED_TRANSIENT') {
            await ledger.transition(record.actionId, 'PENDING_EXECUTION', {}, 'fresh Calendar read found the approved effect already present');
            record = await ledger.claimNext(workflowId);
            if (!record || record.actionId !== initial.actionId) throw new Error('another action is already being executed for this workflow');
          } else if (record.status === 'PENDING_EXECUTION') {
            record = await ledger.claimNext(workflowId);
            if (!record || record.actionId !== initial.actionId) throw new Error('another action is already being executed for this workflow');
          } else if (record.status === 'EXECUTING') {
            record = await ledger.transition(record.actionId, 'EXECUTED_UNVERIFIED', {
              externalResponse: preflight.observed,
            }, 'recovered external write by fresh Calendar read');
          }
          if (record.status === 'EXECUTING') {
            record = await ledger.transition(record.actionId, 'EXECUTED_UNVERIFIED', {
              externalResponse: preflight.observed,
            }, 'recovered idempotent Calendar result');
          }
        } else {
          if (record.status === 'EXECUTED_UNVERIFIED') {
            await ledger.transition(record.actionId, 'REPLAN_REQUIRED', { failureReason: 'external state does not match the approved result' }, 'verification failed during resume');
            throw new Error(`Could not verify “${record.action.summary}”; the plan needs review.`);
          }
          if (record.status === 'AUTHORIZED') {
            await ledger.transition(record.actionId, 'PENDING_EXECUTION', {}, 'workflow broker claimed authorized action');
            record = await ledger.claimNext(workflowId);
          } else if (record.status === 'FAILED_TRANSIENT') {
            await ledger.transition(record.actionId, 'PENDING_EXECUTION', {}, 'retrying transient broker failure after fresh precondition read');
            record = await ledger.claimNext(workflowId);
          } else if (record.status === 'PENDING_EXECUTION') {
            record = await ledger.claimNext(workflowId);
          } else if (record.status === 'EXECUTING') {
            record = await ledger.transition(record.actionId, 'EXECUTING', {}, 'reclaimed interrupted idempotent Calendar action');
          }
          if (!record || record.actionId !== initial.actionId || record.status !== 'EXECUTING') {
            throw new Error('another action is already being executed for this workflow');
          }
          const response = await executeCalendarAction(calendar, snapshot.state, record);
          record = await ledger.transition(record.actionId, 'EXECUTED_UNVERIFIED', { externalResponse: response }, 'Calendar API returned; independent verification follows');
        }

        const verified = await verifyCalendarAction(calendar, snapshot.state, record);
        if (!verified.ok) {
          await ledger.transition(record.actionId, 'REPLAN_REQUIRED', { failureReason: 'Calendar read-back did not match the approved intent' }, 'external mutation could not be verified');
          throw new Error(`Calendar did not match approved action “${record.action.summary}”.`);
        }
        await ledger.transition(record.actionId, 'VERIFIED', {
          verification: { verifiedAtIso: new Date().toISOString(), observed: verified.observed },
        }, 'fresh Calendar read matches the approved intent');
      } catch (error) {
        const latest = ledger.get(initial.actionId);
        if (latest?.status === 'EXECUTING') {
          const transient = error instanceof ToolError && error.transient;
          await ledger.transition(initial.actionId, transient ? 'FAILED_TRANSIENT' : 'FAILED_PERMANENT', {
            failureReason: error instanceof Error ? error.message : String(error),
          }, 'Calendar broker stopped safely');
          if (!transient) {
            await ledger.transition(initial.actionId, 'REPLAN_REQUIRED', {}, 'the approved action cannot safely continue');
          }
        } else if ((latest?.status === 'AUTHORIZED' || latest?.status === 'PENDING_EXECUTION')
          && !(error instanceof ToolError && error.transient)) {
          await ledger.transition(initial.actionId, 'STALE', {
            failureReason: error instanceof Error ? error.message : String(error),
          }, 'fresh Calendar precondition did not match the approved plan');
        } else if (latest?.status === 'FAILED_TRANSIENT' && !(error instanceof ToolError && error.transient)) {
          await ledger.transition(initial.actionId, 'FAILED_PERMANENT', {
            failureReason: error instanceof Error ? error.message : String(error),
          }, 'retry precondition no longer matches the approved plan');
          await ledger.transition(initial.actionId, 'REPLAN_REQUIRED', {}, 'the interrupted action cannot safely continue');
        }
        const refreshed = await store.listWorkflowActionRecords(accountId, workflowId);
        return waitForReview(workflowStore, run, workflowId,
          refreshed.filter((item) => item.status !== 'VERIFIED').length,
          error instanceof Error ? error.message : String(error));
      }
    }

    const verifiedRecords = await store.listWorkflowActionRecords(accountId, workflowId);
    await store.applyVerifiedCalendarActions(accountId, verifiedRecords, evidence, executionClient);
    return { status: 'RESOLVED', workflowId, verifiedActions: verifiedRecords.length };
    });
    if (result.status === 'RESOLVED') {
      const workflowStore = new PostgresWorkflowStore(store, accountId);
      const run = await workflowStore.get(workflowId);
      if (run) {
        run.status = 'RESOLVED';
        run.statusReason = 'All approved Calendar actions were independently verified and committed to the account graph.';
        await workflowStore.save(run);
      }
    }
    return result;
  } catch (error) {
    const workflowStore = new PostgresWorkflowStore(store, accountId);
    const run = await workflowStore.get(workflowId).catch(() => undefined);
    if (run) {
      run.status = 'WAITING_REVIEW';
      run.statusReason = error instanceof Error ? error.message : String(error);
      await workflowStore.save(run).catch(() => undefined);
    }
    const records = await store.listWorkflowActionRecords(accountId, workflowId).catch(() => []);
    return {
      status: 'WAITING_REVIEW', workflowId,
      verifiedActions: records.filter((record) => record.status === 'VERIFIED').length,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function graphReflectsVerifiedActions(state: DomainState, records: ActionRecord[]): boolean {
  return records.every((record) => {
    if (record.status !== 'VERIFIED') return false;
    const action = record.action;
    const desired = action.desired_state as Record<string, unknown>;
    if (action.type === 'DELETE_CALENDAR_EVENT') return state.commitments[action.target]?.status === 'DROPPED';
    if (action.type === 'CREATE_CALENDAR_EVENT') {
      const response = record.externalResponse as { id?: unknown; metadata?: { googleEventId?: unknown } } | undefined;
      const googleEventId = typeof response?.id === 'string' ? response.id
        : typeof response?.metadata?.googleEventId === 'string' ? response.metadata.googleEventId : undefined;
      if (!googleEventId) return false;
      const commitment = state.commitments[`cal-${googleEventId}`];
      return commitmentMatchesDesired(commitment, desired, state.horizonStartIso);
    }
    const commitment = state.commitments[action.target];
    if (!commitment || typeof desired.start_iso !== 'string' || typeof desired.end_iso !== 'string') return false;
    try {
      const startMin = isoToMinutes(desired.start_iso, state.horizonStartIso);
      const endMin = isoToMinutes(desired.end_iso, state.horizonStartIso);
      return commitment.startMin === startMin && commitment.durationMin === endMin - startMin
        && (typeof desired.title !== 'string' || commitment.title === desired.title);
    } catch {
      return false;
    }
  });
}

function commitmentMatchesDesired(
  commitment: Commitment | undefined,
  desired: Record<string, unknown>,
  horizonStartIso: string,
): boolean {
  if (!commitment || typeof desired.start_iso !== 'string' || typeof desired.end_iso !== 'string') return false;
  try {
    const startMin = isoToMinutes(desired.start_iso, horizonStartIso);
    const endMin = isoToMinutes(desired.end_iso, horizonStartIso);
    return commitment.startMin === startMin && commitment.durationMin === endMin - startMin
      && (typeof desired.title !== 'string' || commitment.title === desired.title);
  } catch {
    return false;
  }
}

async function inspectCalendarAction(
  calendar: GoogleUserCalendarTool,
  state: DomainState,
  record: ActionRecord,
): Promise<{ alreadyApplied: boolean; observed: CalendarEvent | null }> {
  const action = record.action;
  const desired = action.desired_state as Record<string, unknown>;
  if (action.type === 'CREATE_CALENDAR_EVENT') {
    const current = await calendar.verifyEvent({ id: record.idempotencyKey });
    if (!current) return { alreadyApplied: false, observed: null };
    if (!matchesDesired(current, desired)) throw new Error(`Calendar id ${action.target} exists with different content`);
    return { alreadyApplied: true, observed: current };
  }
  const commitment = state.commitments[action.target];
  if (!commitment?.externalId) throw new Error(`Calendar source id is missing for ${action.target}`);
  const current = await calendar.verifyEvent({ id: `google:${commitment.externalId}` });
  if (action.type === 'DELETE_CALENDAR_EVENT') {
    if (!current) return { alreadyApplied: true, observed: null };
    if (!matchesCommitment(current, commitment, state.horizonStartIso, state.timezone ?? 'UTC')) {
      throw new Error(`Calendar event for ${commitment.title} changed after approval`);
    }
    return { alreadyApplied: false, observed: current };
  }
  if (!current) throw new Error(`Calendar event for ${commitment.title} is no longer available`);
  if (matchesDesired(current, desired)) return { alreadyApplied: true, observed: current };
  if (!matchesCommitment(current, commitment, state.horizonStartIso, state.timezone ?? 'UTC')) {
    throw new Error(`Calendar event for ${commitment.title} changed after approval`);
  }
  return { alreadyApplied: false, observed: current };
}

async function executeCalendarAction(calendar: GoogleUserCalendarTool, state: DomainState, record: ActionRecord): Promise<unknown> {
  const action = record.action;
  const desired = action.desired_state as Record<string, unknown>;
  if (action.type === 'CREATE_CALENDAR_EVENT') {
    const event = calendarEventFromAction(action, record.idempotencyKey);
    return calendar.createEvent(event);
  }
  const commitment = state.commitments[action.target];
  if (!commitment?.externalId) throw new Error(`Calendar source id is missing for ${action.target}`);
  if (action.type === 'MOVE_CALENDAR_EVENT') {
    await calendar.moveEvent(`google:${commitment.externalId}`, String(desired.start_iso), String(desired.end_iso));
    return { moved: true, googleEventId: commitment.externalId };
  }
  if (action.type === 'DELETE_CALENDAR_EVENT') {
    await calendar.deleteEvent(`google:${commitment.externalId}`);
    return { deleted: true, googleEventId: commitment.externalId };
  }
  throw new Error(`unsupported Calendar action ${action.type}`);
}

async function verifyCalendarAction(
  calendar: GoogleUserCalendarTool,
  state: DomainState,
  record: ActionRecord,
): Promise<{ ok: boolean; observed: unknown }> {
  const action = record.action;
  if (action.type === 'CREATE_CALENDAR_EVENT') {
    const event = await calendar.verifyEvent({ id: record.idempotencyKey });
    return { ok: Boolean(event && matchesDesired(event, action.desired_state as Record<string, unknown>)), observed: event };
  }
  const commitment = state.commitments[action.target];
  if (!commitment?.externalId) return { ok: false, observed: null };
  const event = await calendar.verifyEvent({ id: `google:${commitment.externalId}` });
  if (action.type === 'DELETE_CALENDAR_EVENT') return { ok: event === null, observed: event };
  return { ok: Boolean(event && matchesDesired(event, action.desired_state as Record<string, unknown>)), observed: event };
}

function calendarEventFromAction(action: ActionRecord['action'], id: string): CalendarEvent {
  const desired = action.desired_state as Record<string, unknown>;
  if (typeof desired.title !== 'string' || typeof desired.start_iso !== 'string' || typeof desired.end_iso !== 'string') {
    throw new Error(`Calendar create action ${action.target} is missing title or absolute time`);
  }
  if (!Number.isFinite(Date.parse(desired.start_iso)) || !Number.isFinite(Date.parse(desired.end_iso))
    || Date.parse(desired.end_iso) <= Date.parse(desired.start_iso)) {
    throw new Error(`Calendar create action ${action.target} has invalid absolute time`);
  }
  return { id, title: desired.title, startIso: desired.start_iso, endIso: desired.end_iso };
}

function matchesDesired(event: CalendarEvent, desired: Record<string, unknown>): boolean {
  const expectedTitle = typeof desired.title === 'string' ? desired.title : undefined;
  return (!expectedTitle || event.title === expectedTitle)
    && typeof desired.start_iso === 'string'
    && typeof desired.end_iso === 'string'
    && sameInstant(event.startIso, desired.start_iso)
    && sameInstant(event.endIso, desired.end_iso);
}

function matchesCommitment(event: CalendarEvent, commitment: Commitment, horizonStartIso: string, timezone: string): boolean {
  if (commitment.startMin === undefined) return false;
  try {
    const start = calendarIsoToMinutes(event.startIso, horizonStartIso, timezone);
    const end = calendarIsoToMinutes(event.endIso, horizonStartIso, timezone);
    return start === commitment.startMin && end - start === (commitment.durationMin ?? 0);
  } catch {
    return false;
  }
}

function sameInstant(actual: string, expected: string): boolean {
  return Number.isFinite(Date.parse(actual)) && Number.isFinite(Date.parse(expected))
    && Date.parse(actual) === Date.parse(expected);
}

async function waitForReview(
  workflowStore: PostgresWorkflowStore,
  run: WorkflowRun | undefined,
  workflowId: string,
  remainingActions: number,
  reason: string,
): Promise<AccountWorkflowResumeResult> {
  if (!run) throw new Error('workflow not found');
  run.status = 'WAITING_REVIEW';
  run.statusReason = reason;
  run.userInterventions += 1;
  await workflowStore.save(run);
  return { status: 'WAITING_REVIEW', workflowId, verifiedActions: 0, reason };
}

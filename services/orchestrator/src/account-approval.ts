import { createHash } from 'node:crypto';
import type { ActionRecord } from '@dira/action-ledger';
import { isoToMinutes, localDateTimeToIso, type Commitment } from '@dira/commitment-model';
import { GoogleUserCalendarTool } from '@dira/adapter-calendar/user-google';
import { PostgresWorkflowStore, type ApprovalRevalidationEvidence, type PostgresAccountStore } from './postgres-store.js';
import { availabilityIntervals, prepareAccountSchedule, rebaseDomainState, stableActionIntentKey } from './account-planning.js';

export type ApprovalRevalidation =
  | { ok: true; evidence: ApprovalRevalidationEvidence; checkedCalendarEvents: number; planLabel: string }
  | { ok: false; reason: string; retryable?: boolean };

/** Re-read Google Calendar, then rerun the deterministic solver and policy before recording an approval. */
export async function revalidateAccountApproval(
  store: PostgresAccountStore,
  accountId: string,
  actionId: string,
  getAccessToken: () => Promise<string>,
  stage: 'approval' | 'resume' | 'autonomous' = 'approval',
): Promise<ApprovalRevalidation> {
  const record = await store.getActionRecord(accountId, actionId);
  const resumableStatus = record && ['AUTHORIZED', 'FAILED_TRANSIENT', 'PENDING_EXECUTION'].includes(record.status);
  const statusIsValid = stage === 'approval'
    ? record?.status === 'AWAITING_APPROVAL'
    : stage === 'autonomous' ? record?.status === 'AUTHORIZED' : Boolean(resumableStatus);
  if (!record || !statusIsValid) {
    return { ok: false, reason: stage === 'approval' ? 'The action is no longer awaiting approval.' : 'The action is not authorized for workflow resumption.' };
  }
  const run = await new PostgresWorkflowStore(store, accountId).get(record.workflowId);
  if (!run || (stage === 'approval'
    ? run.status !== 'AWAITING_APPROVAL'
    : stage === 'autonomous' ? run.status !== 'RUNNING'
      : !['AWAITING_APPROVAL', 'WAITING_REVIEW', 'RUNNING'].includes(run.status))) {
    return { ok: false, reason: 'The workflow is no longer awaiting approval.' };
  }
  const workflowRecords = await store.listWorkflowActionRecords(accountId, record.workflowId);
  if (workflowRecords.some((item) => item.status === 'REJECTED' || item.status === 'STALE' || item.status === 'REPLAN_REQUIRED')) {
    return { ok: false, reason: 'Another action in this plan was rejected or invalidated; create a fresh plan.' };
  }
  const approvalRecords = workflowRecords.filter((item) => item.policyVerdict === 'REQUIRE_APPROVAL');
  const validApprovalStatuses = stage === 'approval'
    ? ['AWAITING_APPROVAL', 'AUTHORIZED']
    : stage === 'autonomous' ? ['AUTHORIZED']
      : ['AWAITING_APPROVAL', 'AUTHORIZED', 'FAILED_TRANSIENT', 'PENDING_EXECUTION'];
  if (approvalRecords.some((item) => !validApprovalStatuses.includes(item.status))) {
    return { ok: false, reason: 'The plan approval state is inconsistent; create a fresh plan.' };
  }
  if (stage === 'autonomous' && (approvalRecords.length > 0 || workflowRecords.some((item) =>
    item.policyVerdict !== 'ALLOW' && item.policyVerdict !== 'ALLOW_AND_NOTIFY'))) {
    return { ok: false, reason: 'An autonomous workflow must contain only policy-allowed actions.' };
  }

  const snapshot = await store.loadAccountPlanningSnapshot(accountId);
  if (!snapshot) return { ok: false, reason: 'Set focus hours and refresh the schedule before approval.' };
  if (snapshot.policy.fencedCalendarIds.includes('primary')) {
    const reason = 'Primary Google Calendar is fenced by account policy. Re-enable access before approval or resume.';
    await store.recordPolicyBlock(accountId, {
      actionType: 'READ_CALENDAR', targetId: 'primary', policyRule: 'fenced-calendar', reason,
    });
    return { ok: false, reason };
  }
  const now = new Date();
  const oldState = snapshot.state;
  const oldNowMin = isoToMinutes(now.toISOString(), oldState.horizonStartIso);
  const calendar = new GoogleUserCalendarTool(
    getAccessToken,
    undefined,
    async () => (await store.getAccountPolicySettings(accountId)).fencedCalendarIds.includes('primary'),
  );
  const freshReads: { id: string; startIso: string; endIso: string }[] = [];

  for (const commitment of Object.values(oldState.commitments)) {
    if (!isUpcomingCalendarCommitment(commitment, oldNowMin)) continue;
    if (!commitment.externalId) return { ok: false, reason: `“${commitment.title}” has no Calendar source id.` };
    let event;
    try {
      event = await calendar.verifyEvent({ id: `google:${commitment.externalId}` });
    } catch {
      return { ok: false, retryable: true, reason: `Could not freshly read Calendar item for “${commitment.title}”. Nothing was authorized; retry when Calendar is reachable.` };
    }
    if (!event) return { ok: false, reason: `Calendar item for “${commitment.title}” was removed or is no longer accessible. Refresh the graph and request a new plan.` };
    const observedStart = calendarIsoToMinutes(event.startIso, oldState.horizonStartIso, oldState.timezone ?? 'UTC');
    const observedEnd = calendarIsoToMinutes(event.endIso, oldState.horizonStartIso, oldState.timezone ?? 'UTC');
    const expected = commitment.kind === 'effort'
      ? commitment.deadlineMin
      : commitment.startMin;
    const observedDeadline = /^\d{4}-\d{2}-\d{2}$/.test(event.startIso)
      ? observedEnd
      : observedStart;
    if (commitment.kind === 'effort') {
      if (expected === undefined || observedDeadline !== expected) {
        return { ok: false, reason: `Calendar deadline for “${commitment.title}” changed. Refresh the graph and request a new plan.` };
      }
    } else if (commitment.startMin !== observedStart || (commitment.durationMin ?? 0) !== observedEnd - observedStart) {
      return { ok: false, reason: `Calendar time for “${commitment.title}” changed. Refresh the graph and request a new plan.` };
    }
    freshReads.push({ id: event.id, startIso: event.startIso, endIso: event.endIso });
  }

  const state = rebaseDomainState(oldState, now);
  state.availability = availabilityIntervals(snapshot.profile, state, now);
  const { ranked } = prepareAccountSchedule(state, snapshot.policy);
  const expectedKeys = workflowRecords.map((item) => stableActionIntentKey(item.action)).sort();
  const matching = ranked.find((validation) => {
    if (!validation.acceptable) return false;
    const denied = validation.policy.decisions.some((decision) => decision.verdict === 'DENY');
    if (denied) return false;
    const actionKeys = validation.plan.actions.map(stableActionIntentKey).sort();
    return arraysEqual(actionKeys, expectedKeys);
  });
  if (!matching) {
    return { ok: false, reason: 'Fresh Calendar state, feasibility, or policy no longer matches this plan. Check the schedule and request a new plan.' };
  }
  if (stage !== 'autonomous' && !approvalRecords.some((item) => item.actionId === actionId)) {
    return { ok: false, reason: 'This action is not part of the current approval plan.' };
  }

  const revalidatedAtIso = new Date().toISOString();
  const evidence = {
    accountId,
    workflowId: record.workflowId,
    actionIds: workflowRecords.map((item) => item.actionId).sort(),
    freshReads,
    feasibility: {
      globalSlackMinutes: matching.feasibility.global_slack_minutes,
      violations: matching.feasibility.violations,
    },
    policy: matching.policy.decisions,
    planId: matching.plan.id,
    stateVersion: snapshot.stateVersion,
    profileVersion: snapshot.profileVersion,
    policyVersion: snapshot.policyVersion,
    revalidatedAtIso,
  };
  return {
    ok: true,
    evidence: {
      revalidatedAtIso,
      evidenceHash: createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
      stateVersion: snapshot.stateVersion,
      profileVersion: snapshot.profileVersion,
      policyVersion: snapshot.policyVersion,
    },
    checkedCalendarEvents: freshReads.length,
    planLabel: matching.plan.label,
  };
}

function isUpcomingCalendarCommitment(commitment: Commitment, nowMin: number): boolean {
  if (commitment.externalSystem !== 'calendar' || commitment.status === 'DROPPED' || commitment.status === 'COMPLETE') return false;
  if (commitment.kind === 'effort') return (commitment.deadlineMin ?? Number.NEGATIVE_INFINITY) >= nowMin;
  return commitment.startMin !== undefined
    && commitment.startMin + (commitment.durationMin ?? 0) >= nowMin;
}

export function calendarIsoToMinutes(value: string, horizonStartIso: string, timezone: string): number {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? localDateTimeToIso(`${value}T00:00`, timezone)
    : new Date(Date.parse(value)).toISOString();
  return isoToMinutes(iso, horizonStartIso);
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

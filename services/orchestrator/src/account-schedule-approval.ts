import { randomUUID } from 'node:crypto';
import { ActionLedger } from '@dira/action-ledger';
import type { WorkflowRun } from '@dira/agent';
import { prepareAccountSchedule, stableActionIntentKey } from './account-planning.js';
import { PostgresLedgerStore, PostgresWorkflowStore, type PostgresAccountStore } from './postgres-store.js';

export type AccountScheduleCandidate = ReturnType<typeof prepareAccountSchedule>['ranked'][number];

export type ScheduleApprovalRequestResult =
  | { status: 'CREATED'; workflowId: string; approvalCount: number; actionIds: string[] }
  | { status: 'ALREADY_PENDING' }
  | { status: 'NO_APPROVAL_REQUIRED' };

/** Persist a validated deterministic candidate as an owner-reviewable workflow. */
export async function createScheduleApprovalRequest(
  store: PostgresAccountStore,
  accountId: string,
  validation: AccountScheduleCandidate,
): Promise<ScheduleApprovalRequestResult> {
  const locked = await store.withAdvisoryJobLock(accountId, 'schedule-approval-request', () =>
    persistScheduleApprovalRequest(store, accountId, validation));
  return locked.acquired ? locked.value : { status: 'ALREADY_PENDING' };
}

async function persistScheduleApprovalRequest(
  store: PostgresAccountStore,
  accountId: string,
  validation: AccountScheduleCandidate,
): Promise<ScheduleApprovalRequestResult> {
  const planActions = validation.plan.actions
    .map((action, index) => ({ action, decision: validation.policy.decisions[index]! }));
  if (planActions.some(({ decision }) => decision.verdict === 'DENY')) {
    throw new Error('a denied action cannot be included in a schedule approval request');
  }
  const pending = planActions.filter(({ decision }) => decision.verdict === 'REQUIRE_APPROVAL');
  if (pending.length === 0) return { status: 'NO_APPROVAL_REQUIRED' };
  const pendingApprovals = await store.listPendingApprovals(accountId);
  if (pendingApprovals.length) return { status: 'ALREADY_PENDING' };

  const ledger = await ActionLedger.open(new PostgresLedgerStore(store, accountId));
  const existingPendingKeys = new Set(ledger.all()
    .filter((record) => ['AWAITING_APPROVAL', 'AUTHORIZED', 'PENDING_EXECUTION', 'EXECUTING', 'EXECUTED_UNVERIFIED', 'FAILED_TRANSIENT'].includes(record.status))
    .map((record) => stableActionIntentKey(record.action)));
  if (planActions.some(({ action }) => existingPendingKeys.has(stableActionIntentKey(action)))) {
    return { status: 'ALREADY_PENDING' };
  }

  const eventId = `account-plan-${randomUUID()}`;
  const workflowId = `wf-${eventId}`;
  const requestedAtIso = new Date().toISOString();
  const actionIds: string[] = [];
  for (const [index, { action, decision }] of planActions.entries()) {
    const persisted = await ledger.persistIntent(
      workflowId,
      action,
      decision.verdict,
      decision.rule,
      { planId: validation.plan.id, seq: index },
    );
    if (persisted.record.status === 'PLANNED') {
      if (decision.verdict === 'REQUIRE_APPROVAL') {
        const awaiting = await ledger.transition(persisted.record.actionId, 'AWAITING_APPROVAL', {
          approval: { requestedAtIso },
        }, 'feasible plan held for authenticated account-owner decision');
        actionIds.push(awaiting.actionId);
      } else {
        await ledger.transition(persisted.record.actionId, 'AUTHORIZED', {}, 'deterministic policy permits this action; held until the plan approvals are complete');
      }
    } else if (persisted.record.status === 'AWAITING_APPROVAL' && decision.verdict === 'REQUIRE_APPROVAL') {
      actionIds.push(persisted.record.actionId);
    }
  }
  if (actionIds.length === 0) return { status: 'ALREADY_PENDING' };

  const run: WorkflowRun = {
    id: workflowId,
    eventId,
    status: 'AWAITING_APPROVAL',
    statusReason: 'A feasible schedule plan contains action(s) requiring the account owner’s approval.',
    mutationSummary: `Schedule review: ${validation.plan.label}`,
    impacts: [],
    affected: [],
    planningRounds: [[{
      id: validation.plan.id,
      label: validation.plan.label,
      acceptable: false,
      autonomous: false,
      costTotal: validation.cost.total,
      slackMinutes: validation.feasibility.global_slack_minutes,
      rejectionReason: 'Awaiting authenticated account-owner approval.',
      actionCount: validation.plan.actions.length,
    }]],
    selectedPlanIds: [validation.plan.id],
    failuresRecovered: 0,
    replans: 0,
    userInterventions: 0,
  };
  await new PostgresWorkflowStore(store, accountId).save(run);
  return { status: 'CREATED', workflowId, approvalCount: actionIds.length, actionIds };
}

/** After a confirmed graph change, queue the best deterministic repair that needs owner approval. */
export async function createApprovalForCurrentFeasibility(
  store: PostgresAccountStore,
  accountId: string,
): Promise<ScheduleApprovalRequestResult | undefined> {
  const [profile, pendingApprovals] = await Promise.all([
    store.getAvailabilityProfile(accountId),
    store.listPendingApprovals(accountId),
  ]);
  if (!profile || pendingApprovals.length) return pendingApprovals.length ? { status: 'ALREADY_PENDING' } : undefined;
  const [state, policy] = await Promise.all([
    store.ensureDomainState(accountId),
    store.getAccountPolicySettings(accountId),
  ]);
  if (policy.fencedCalendarIds.includes('primary')) return undefined;
  const prepared = prepareAccountSchedule(state, policy);
  if (!prepared.feasibility.violations.length) return undefined;
  const candidate = prepared.ranked.find((item) => item.acceptable
    && item.policy.decisions.some((decision) => decision.verdict === 'REQUIRE_APPROVAL')
    && !item.policy.decisions.some((decision) => decision.verdict === 'DENY')
    && item.plan.actions.every((action) => action.external_system === 'calendar'
      && ['CREATE_CALENDAR_EVENT', 'MOVE_CALENDAR_EVENT', 'DELETE_CALENDAR_EVENT'].includes(action.type)));
  if (!candidate) return undefined;
  return createScheduleApprovalRequest(store, accountId, candidate);
}

import type { DomainState } from '@dira/commitment-model';
import { normalizeActionTimes } from '@dira/agent';
import type { ActionRecord } from '@dira/action-ledger';
import { applyAction, validatePlan } from '@dira/constraint-engine';
import { applyRulesToPlanningState } from '@dira/policy-engine';
import { googleEventIdFor } from '@dira/adapter-calendar/user-google';
import { availabilityIntervals, rebaseDomainState, type AvailabilityProfile } from './account-planning.js';
import type { AccountPolicySettings } from './account-policy.js';
import { calendarProviderId } from './calendar-receipt.js';
import type { CalendarCreatedIntent } from './calendar-occupancy.js';

export function createdCalendarIntent(record: ActionRecord): CalendarCreatedIntent {
  const desired = record.action.desired_state as Record<string, unknown>;
  return { logicalId: record.idempotencyKey, googleEventId: googleEventIdFor(record.idempotencyKey),
    title: String(desired.title), startIso: String(desired.start_iso), endIso: String(desired.end_iso) };
}

export function verifiedCalendarState(state: DomainState, records: ActionRecord[]): DomainState {
  let observed = structuredClone(state);
  for (const record of [...records].filter(r => r.status === 'VERIFIED').sort((a,b) => (a.planSeq ?? 0)-(b.planSeq ?? 0))) {
    const action = normalizeActionTimes(record.action, observed.horizonStartIso);
    observed = applyAction(observed, action);
    if (action.type === 'CREATE_CALENDAR_EVENT') {
      const providerId = calendarProviderId(record.externalResponse);
      if (!providerId || providerId !== googleEventIdFor(record.idempotencyKey)) throw new Error('Verified Calendar create has no matching provider receipt');
      observed.commitments[action.target]!.externalId = providerId;
    }
  }
  return observed;
}

/** Recheck the remaining approved intents against a fresh clock on every
 * resume and before each mutation. Completed effects are never replayed. */
export function assertRemainingCalendarPlanFresh(
  original: DomainState, profile: AvailabilityProfile, records: ActionRecord[], policy: AccountPolicySettings, now = new Date(),
): DomainState {
  const observed = verifiedCalendarState(original, records);
  const pending = [...records].filter(r => r.status !== 'VERIFIED').sort((a,b) => (a.planSeq ?? 0)-(b.planSeq ?? 0));
  if (!pending.length) return observed;
  for (const record of pending) {
    if (!['CREATE_CALENDAR_EVENT','MOVE_CALENDAR_EVENT','BOOK_INTERVIEW_SLOT'].includes(record.action.type)) continue;
    const desired = record.action.desired_state as Record<string,unknown>;
    if (typeof desired.start_iso !== 'string' || !Number.isFinite(Date.parse(desired.start_iso)) || Date.parse(desired.start_iso) < now.getTime()) {
      throw new Error('An approved Calendar slot has passed. Request a fresh plan before resuming.');
    }
  }
  const rebased = rebaseDomainState(observed, now);
  rebased.availability = availabilityIntervals(profile, rebased, now);
  const planning = applyRulesToPlanningState(rebased, policy.correctionRules);
  const checked = validatePlan(planning, { id:'resume-check', label:'Remaining approved Calendar intents', notes:[],
    actions:pending.map(r => normalizeActionTimes(r.action, rebased.horizonStartIso)) });
  if (!checked.acceptable) throw new Error(`Remaining Calendar plan is no longer feasible: ${checked.rejectionReason ?? 'fresh schedule check failed'}. Request a fresh plan.`);
  return observed;
}

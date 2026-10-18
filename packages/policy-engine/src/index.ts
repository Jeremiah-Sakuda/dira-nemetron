import {
  commitmentStakeholders,
  delegationTargets,
  isoToMinutes,
  localDateTimeToIso,
  overlaps,
  subtractIntervals,
  type DomainState,
  type Interval,
} from '@dira/commitment-model';
import type { PlannedAction } from '@dira/event-schema';

/**
 * Autonomy policy engine (PRD §21) + action provenance (PRD §22).
 *
 * Deterministic. Every mutating operation passes through here; the planner
 * and the executor both refuse actions without an ALLOW/ALLOW_AND_NOTIFY
 * verdict. Provenance is checked structurally: an action must trace its
 * authority to stored evidence (a recruiter-offered slot, a DELEGATABLE_TO
 * edge, a user policy) or it is invalid regardless of what any model said.
 */

export type PolicyVerdict = 'ALLOW' | 'ALLOW_AND_NOTIFY' | 'REQUIRE_APPROVAL' | 'DENY';

export interface PolicyDecision {
  verdict: PolicyVerdict;
  rule: string;
  reason: string;
}

export interface PolicyRuleOverride {
  rule: string;
  scope?: { domain?: string; commitmentId?: string; personId?: string };
}

/**
 * A correction the account owner confirmed after editing or rejecting an
 * action. Rules can only tighten policy: they deny or require approval, never
 * grant a new action. Unconfirmed candidates never reach this engine.
 */
export type CorrectionRule =
  | { id: string; kind: 'PROTECT_COMMITMENT'; commitmentId: string; label: string }
  | { id: string; kind: 'AVOID_WINDOW'; weekdays: number[]; startMinute: number; endMinute: number; label: string }
  | { id: string; kind: 'NEVER_CONTACT'; personId: string; label: string }
  | { id: string; kind: 'ASK_FIRST'; actionType: PlannedAction['type']; label: string };

export function evaluateAction(
  state: DomainState,
  action: PlannedAction,
  requireApproval: readonly PolicyRuleOverride[] = [],
  rules: readonly CorrectionRule[] = [],
): PolicyDecision {
  const base = evaluateActionBase(state, action);
  if (base.verdict !== 'ALLOW' && base.verdict !== 'ALLOW_AND_NOTIFY') return base;
  const decision = applyCorrectionRules(state, action, base, rules);
  if (decision.verdict !== 'ALLOW' && decision.verdict !== 'ALLOW_AND_NOTIFY') return decision;
  const target = state.commitments[action.target];
  const desired = action.desired_state as { new_owner?: unknown };
  const override = requireApproval.find((entry) => entry.rule === decision.rule
    && (!entry.scope?.domain || entry.scope.domain === target?.domain)
    && (!entry.scope?.commitmentId || entry.scope.commitmentId === action.target)
    && (!entry.scope?.personId || entry.scope.personId === desired.new_owner));
  return override
    ? { ...decision, verdict: 'REQUIRE_APPROVAL', reason: `User policy requires approval. ${decision.reason}` }
    : decision;
}

function evaluateActionBase(state: DomainState, action: PlannedAction): PolicyDecision {
  // Universal gate: no provenance → no authority → DENY (PRD §22).
  if (!action.provenance || action.provenance.length === 0) {
    return { verdict: 'DENY', rule: 'provenance-required', reason: 'action lacks provenance' };
  }

  const target = state.commitments[action.target];

  switch (action.type) {
    case 'BOOK_INTERVIEW_SLOT': {
      // Only among options explicitly offered by the recruiter.
      if (!target) return deny('unknown-target', `no commitment ${action.target}`);
      const slots = state.approvedSlots[action.target] ?? [];
      const desired = action.desired_state as { start_min?: unknown };
      const match = slots.find((s) => s.startMin === desired.start_min);
      if (!match) {
        return deny(
          'interview-slots-recruiter-approved-only',
          'requested slot is not among recruiter-offered alternatives',
        );
      }
      if (!action.provenance.includes(match.provenance)) {
        return deny(
          'interview-slot-provenance',
          'action does not cite the recruiter message offering this slot',
        );
      }
      return {
        verdict: 'ALLOW',
        rule: 'interview-slots-recruiter-approved-only',
        reason: `slot is recruiter-approved (${match.provenance})`,
      };
    }

    case 'DECLINE_INTERVIEW':
      // Dira may never autonomously decline an interview.
      return {
        verdict: 'REQUIRE_APPROVAL',
        rule: 'never-decline-interview',
        reason: 'declining an interview always requires the user',
      };

    case 'MOVE_CALENDAR_EVENT': {
      if (!target) return deny('unknown-target', `no commitment ${action.target}`);
      if (target.flexibility === 'FIXED') {
        return deny('fixed-commitment-immovable', `${target.title} is FIXED`);
      }
      if (target.flexibility === 'FLEXIBLE' || target.flexibility === 'OPTIONAL') {
        return {
          verdict: 'ALLOW',
          rule: 'move-flexible-or-optional-blocks',
          reason: `${target.title} is ${target.flexibility}`,
        };
      }
      if (target.flexibility === 'MOVE_WITHIN_WINDOW') {
        // Calendar may mirror a booking only onto an explicitly approved slot.
        const slots = state.approvedSlots[action.target] ?? [];
        const desired = action.desired_state as { start_min?: unknown };
        const match = slots.find((s) => s.startMin === desired.start_min);
        if (match && action.provenance.includes(match.provenance)) {
          return {
            verdict: 'ALLOW',
            rule: 'sync-calendar-with-approved-booking',
            reason: `mirrors the recruiter-approved slot (${match.provenance})`,
          };
        }
        return deny(
          'window-move-requires-approved-slot',
          'window-bound commitments may only move onto approved alternatives',
        );
      }
      return {
        verdict: 'REQUIRE_APPROVAL',
        rule: 'default-move-requires-approval',
        reason: `moving ${target.flexibility} commitments is not pre-authorized`,
      };
    }

    case 'CREATE_CALENDAR_EVENT': {
      const d = action.desired_state as { reserves_effort_for?: unknown };
      if (typeof d.reserves_effort_for === 'string') {
        return {
          verdict: 'ALLOW',
          rule: 'restructure-study-blocks',
          reason: 'creating study/effort reservations is pre-authorized',
        };
      }
      return {
        verdict: 'REQUIRE_APPROVAL',
        rule: 'new-commitments-require-approval',
        reason: 'creating non-reservation events is not pre-authorized',
      };
    }

    case 'DELETE_CALENDAR_EVENT': {
      if (!target) return deny('unknown-target', `no commitment ${action.target}`);
      if (target.reservesEffortFor) {
        return {
          verdict: 'ALLOW',
          rule: 'restructure-study-blocks',
          reason: 'removing an invalidated reservation is pre-authorized',
        };
      }
      if (target.criticality === 'CRITICAL' || target.criticality === 'HIGH') {
        return {
          verdict: 'REQUIRE_APPROVAL',
          rule: 'critical-commitments-protected',
          reason: `${target.title} is ${target.criticality}`,
        };
      }
      return {
        verdict: 'REQUIRE_APPROVAL',
        rule: 'deletion-requires-approval',
        reason: 'deleting real commitments is not pre-authorized',
      };
    }

    case 'DELEGATE_TASK': {
      if (!target) return deny('unknown-target', `no commitment ${action.target}`);
      const d = action.desired_state as { new_owner?: unknown };
      const targets = delegationTargets(state, action.target);
      if (
        target.flexibility === 'DELEGATABLE' &&
        typeof d.new_owner === 'string' &&
        targets.includes(d.new_owner)
      ) {
        return {
          verdict: 'ALLOW_AND_NOTIFY',
          rule: 'delegate-explicitly-delegatable',
          reason: `${d.new_owner} is a stored DELEGATABLE_TO backup for ${target.title}`,
        };
      }
      return deny(
        'delegation-scope',
        'target is not delegatable to the proposed owner (no DELEGATABLE_TO edge)',
      );
    }

    case 'SEND_NOTIFICATION': {
      // Recipients are restricted to stored stakeholders of the commitment the
      // message is about, at their stored address. A model, an email, or a
      // plan can never introduce a new recipient.
      const d = action.desired_state as { about?: unknown; recipient_person_id?: unknown; to?: unknown };
      if (typeof d.about !== 'string' || !state.commitments[d.about]) {
        return deny('notification-subject-required', 'notification does not reference a stored commitment');
      }
      const personId = typeof d.recipient_person_id === 'string' ? d.recipient_person_id : '';
      const person = state.people[personId];
      if (!person || !commitmentStakeholders(state, d.about).includes(personId)) {
        return deny('recipient-not-stakeholder', `recipient is not a stakeholder on ${state.commitments[d.about]!.title}`);
      }
      if (typeof d.to !== 'string' || d.to.trim().toLowerCase() !== person.email.trim().toLowerCase()) {
        return deny('recipient-address-mismatch', 'notification address does not match the stored stakeholder address');
      }
      return {
        verdict: 'ALLOW_AND_NOTIFY',
        rule: 'routine-operational-updates',
        reason: `routine update to ${person.name}, a stakeholder on ${state.commitments[d.about]!.title}`,
      };
    }

    default:
      return deny('unsupported-action', `no rule covers action type ${(action as PlannedAction).type}`);
  }

  function deny(rule: string, reason: string): PolicyDecision {
    return { verdict: 'DENY', rule, reason };
  }
}

function applyCorrectionRules(
  state: DomainState,
  action: PlannedAction,
  decision: PolicyDecision,
  rules: readonly CorrectionRule[],
): PolicyDecision {
  const desired = action.desired_state as Record<string, unknown>;
  const changesTarget = ['MOVE_CALENDAR_EVENT', 'DELETE_CALENDAR_EVENT', 'DELEGATE_TASK', 'BOOK_INTERVIEW_SLOT', 'DECLINE_INTERVIEW']
    .includes(action.type);
  let askFirst: CorrectionRule | undefined;
  for (const rule of rules) {
    switch (rule.kind) {
      case 'PROTECT_COMMITMENT':
        if (changesTarget && action.target === rule.commitmentId) {
          return { verdict: 'DENY', rule: `user-rule:${rule.id}`, reason: `You asked Dira not to change ${rule.label}.` };
        }
        break;
      case 'NEVER_CONTACT': {
        const contacted = action.type === 'SEND_NOTIFICATION' ? desired.recipient_person_id
          : action.type === 'DELEGATE_TASK' ? desired.new_owner : undefined;
        if (contacted === rule.personId) {
          return { verdict: 'DENY', rule: `user-rule:${rule.id}`, reason: `You asked Dira not to contact ${rule.label}.` };
        }
        break;
      }
      case 'AVOID_WINDOW': {
        if (!['MOVE_CALENDAR_EVENT', 'CREATE_CALENDAR_EVENT', 'BOOK_INTERVIEW_SLOT'].includes(action.type)) break;
        const start = typeof desired.start_min === 'number' ? desired.start_min : undefined;
        const duration = typeof desired.duration_min === 'number' ? desired.duration_min : undefined;
        if (start === undefined || duration === undefined) break;
        const placed = { start, end: start + Math.max(duration, 1) };
        if (materializeRuleWindows(state, [rule]).some((window) => overlaps(window, placed))) {
          return { verdict: 'DENY', rule: `user-rule:${rule.id}`, reason: `You asked Dira to keep ${rule.label} free.` };
        }
        break;
      }
      case 'ASK_FIRST':
        if (action.type === rule.actionType) askFirst = rule;
        break;
    }
  }
  if (askFirst) {
    return { verdict: 'REQUIRE_APPROVAL', rule: `user-rule:${askFirst.id}`, reason: `You asked Dira to check with you before it will ${askFirst.label}. ${decision.reason}` };
  }
  return decision;
}

/** Expand AVOID_WINDOW rules into absolute solver intervals over the horizon (user's local time). */
export function materializeRuleWindows(state: DomainState, rules: readonly CorrectionRule[]): Interval[] {
  const windows: Interval[] = [];
  const timezone = state.timezone ?? 'UTC';
  const days = Math.ceil(state.horizonEndMin / 1440) + 1;
  const startDate = localDate(new Date(Date.parse(state.horizonStartIso)), timezone);
  for (const rule of rules) {
    if (rule.kind !== 'AVOID_WINDOW') continue;
    for (let offset = -1; offset < days; offset += 1) {
      const date = addDays(startDate, offset);
      const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
      if (!rule.weekdays.includes(weekday)) continue;
      try {
        const start = isoToMinutes(localDateTimeToIso(`${date}T${clock(rule.startMinute)}`, timezone), state.horizonStartIso);
        const endDate = rule.endMinute >= 1440 ? addDays(date, 1) : date;
        const end = isoToMinutes(localDateTimeToIso(`${endDate}T${clock(rule.endMinute % 1440)}`, timezone), state.horizonStartIso);
        if (end > 0 && start < state.horizonEndMin && end > start) windows.push({ start, end });
      } catch {
        // A wall-clock time skipped by a DST change: that day has no window.
      }
    }
  }
  return windows;
}

/**
 * Planning view of the world under confirmed rules: avoided windows leave the
 * user's focus capacity and are blocked for relocations. The stored state is
 * never changed, so deleting a rule restores the original behavior.
 */
export function applyRulesToPlanningState(state: DomainState, rules: readonly CorrectionRule[]): DomainState {
  const windows = materializeRuleWindows(state, rules);
  if (!windows.length) return state;
  const next = structuredClone(state);
  next.availability = state.availability.flatMap((window) => subtractIntervals(window, windows));
  next.avoidWindows = windows;
  return next;
}

function localDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** A plan is autonomously executable only if every action is ALLOW-class. */
export function evaluatePlanActions(
  state: DomainState,
  actions: PlannedAction[],
  requireApproval: readonly PolicyRuleOverride[] = [],
  rules: readonly CorrectionRule[] = [],
): { decisions: PolicyDecision[]; autonomous: boolean } {
  const decisions = actions.map((a,index) => {
    const decision=evaluateAction(state,a,requireApproval,rules);
    if(a.type === 'MOVE_CALENDAR_EVENT' && state.commitments[a.target]?.flexibility === 'MOVE_WITHIN_WINDOW') {
      const matching=actions.slice(0,index).some(prior=>prior.type === 'BOOK_INTERVIEW_SLOT' && prior.target === a.target
        && prior.desired_state.start_iso === a.desired_state.start_iso && prior.desired_state.end_iso === a.desired_state.end_iso);
      if(!matching)return {verdict:'DENY' as const,rule:'calendar-mirror-requires-booking',reason:'A window-bound calendar move must follow the matching booking in this plan'};
    }
    return decision;
  });
  const autonomous = decisions.every(
    (d) => d.verdict === 'ALLOW' || d.verdict === 'ALLOW_AND_NOTIFY',
  );
  return { decisions, autonomous };
}

/** Static description of the demo policy for the UI / docs. */
export const DEMO_POLICY_TABLE = [
  { verdict: 'ALLOW', rules: [
    'move flexible study blocks',
    'move optional personal blocks',
    'retry failed actions',
    'select among recruiter-approved interview slots',
  ]},
  { verdict: 'ALLOW_AND_NOTIFY', rules: [
    'delegate explicitly delegatable tasks',
    'send routine operational updates',
  ]},
  { verdict: 'REQUIRE_APPROVAL', rules: [
    'decline an interview',
    'abandon an application',
    'spend money',
    'miss class',
    'disclose sensitive information',
    'make irreversible commitments',
  ]},
  { verdict: 'DENY', rules: [
    'unsupported actions',
    'actions lacking provenance',
    'mutations violating a hard commitment',
    'actions outside tool scope',
  ]},
] as const;

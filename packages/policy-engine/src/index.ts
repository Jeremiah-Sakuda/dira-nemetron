import {
  delegationTargets,
  type DomainState,
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

export function evaluateAction(
  state: DomainState,
  action: PlannedAction,
  requireApproval: readonly PolicyRuleOverride[] = [],
): PolicyDecision {
  const decision = evaluateActionBase(state, action);
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

    case 'SEND_NOTIFICATION':
      return {
        verdict: 'ALLOW_AND_NOTIFY',
        rule: 'routine-operational-updates',
        reason: 'routine operational update',
      };

    default:
      return deny('unsupported-action', `no rule covers action type ${(action as PlannedAction).type}`);
  }

  function deny(rule: string, reason: string): PolicyDecision {
    return { verdict: 'DENY', rule, reason };
  }
}

/** A plan is autonomously executable only if every action is ALLOW-class. */
export function evaluatePlanActions(
  state: DomainState,
  actions: PlannedAction[],
  requireApproval: readonly PolicyRuleOverride[] = [],
): { decisions: PolicyDecision[]; autonomous: boolean } {
  const decisions = actions.map((a) => evaluateAction(state, a, requireApproval));
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

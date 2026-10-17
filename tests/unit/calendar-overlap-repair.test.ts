import { describe, expect, it } from 'vitest';
import { generateCandidatePlans } from '@dira/agent';
import { computeFeasibility, validatePlan } from '@dira/constraint-engine';
import { evaluatePlanActions } from '@dira/policy-engine';
import { isoToMinutes, minutesToIso, type Commitment } from '@dira/commitment-model';
import { createEmptyDomainState } from '../../services/orchestrator/src/postgres-store.js';
import { rebaseDomainState, stableActionIntentKey } from '../../services/orchestrator/src/account-planning.js';

function fixture() {
  const state = createEmptyDomainState('synthetic-owner', 'America/New_York', new Date('2026-10-19T12:00:41.123Z'));
  const start = isoToMinutes('2026-10-19T15:00:00Z', state.horizonStartIso);
  const base: Commitment = {
    id: 'fixed', title: 'Synthetic fixed meeting', domain: 'personal', kind: 'event',
    flexibility: 'FIXED', criticality: 'NORMAL', userId: state.userId, owner: state.userId, participants: [state.userId],
    status: 'PLANNED', goalIds: [], resourceRequirements: ['user-time'], confidence: 1,
    source: 'google-calendar', externalSystem: 'calendar', externalId: 'fixture-fixed',
    createdAtIso: state.horizonStartIso, updatedAtIso: state.horizonStartIso, startMin: start, durationMin: 60,
  };
  state.commitments.fixed = base;
  state.commitments.flexible = { ...base, id: 'flexible', title: 'Synthetic movable preparation', kind: 'block', flexibility: 'FLEXIBLE', externalId: 'fixture-flexible' };
  state.availability = [{ start: 60, end: 540 }];
  return state;
}
function candidates(state: ReturnType<typeof fixture>) {
  return generateCandidatePlans({ state, feasibility: computeFeasibility(state), liveSlots: {}, nowMin: 0 });
}
describe('Calendar-only overlap repair', () => {
  it('repairs an overlap without an effort task, preserving the fixed event and approval policy', () => {
    const state = fixture();
    expect(computeFeasibility(state).violations.some(v => v.type === 'OVERLAP')).toBe(true);
    const plan = candidates(state).find(p => p.id === 'plan-overlap-blocks')!;
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ type: 'MOVE_CALENDAR_EVENT', target: 'flexible' });
    expect(plan.actions[0]!.desired_state.start_iso).toBe('2026-10-19T16:00:00.000Z');
    expect(validatePlan(state, plan).acceptable).toBe(true);
    expect(evaluatePlanActions(state, plan.actions, [{ rule: 'move-flexible-or-optional-blocks' }]).decisions[0]?.verdict).toBe('REQUIRE_APPROVAL');
  });
  it('does not move fixed events or invent a slot when no focus window fits', () => {
    const state = fixture(); state.commitments.flexible!.flexibility = 'FIXED';
    expect(candidates(state).some(p => p.id === 'plan-overlap-blocks')).toBe(false);
    state.commitments.flexible!.flexibility = 'FLEXIBLE'; state.availability = [{ start: 180, end: 240 }];
    expect(candidates(state).some(p => p.id === 'plan-overlap-blocks')).toBe(false);
  });
  it('respects protected windows and avoids existing events', () => {
    const state = fixture(); state.avoidWindows = [{ start: 240, end: 300 }];
    const plan = candidates(state).find(p => p.id === 'plan-overlap-blocks')!;
    expect(plan.actions[0]!.desired_state.start_iso).toBe('2026-10-19T17:00:00.000Z');
    expect(validatePlan(state, plan).acceptable).toBe(true);
  });
  it('keeps the same absolute action after approval-time horizon rebasing', () => {
    const state = fixture();
    const first = candidates(state).find(p => p.id === 'plan-overlap-blocks')!;
    const next = rebaseDomainState(state, new Date('2026-10-19T12:07:53.999Z'));
    next.availability = state.availability.map(w => ({ start: w.start - 7, end: w.end - 7 }));
    const second = candidates(next).find(p => p.id === 'plan-overlap-blocks')!;
    expect(second.actions.map(stableActionIntentKey)).toEqual(first.actions.map(stableActionIntentKey));
    expect(next.horizonStartIso).toBe('2026-10-19T12:07:00.000Z');
    expect(minutesToIso(next.commitments.fixed!.startMin!, next.horizonStartIso, next.timezone)).toBe('2026-10-19T11:00:00-04:00');
  });
});

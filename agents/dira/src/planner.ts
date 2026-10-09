import {
  delegationTargets,
  edgesFrom,
  eventInterval,
  minutesToIso,
  overlaps,
  type Commitment,
  type DomainState,
  type Interval,
} from '@dira/commitment-model';
import {
  applyAction,
  effectiveDeadline,
  scheduleEffort,
  type FeasibilityComputation,
} from '@dira/constraint-engine';
import type { CandidatePlan, PlannedAction } from '@dira/event-schema';

/**
 * Candidate repair search (PRD §19).
 *
 * The planner proposes; the deterministic validator disposes. Candidates are
 * generated from the *current state* — violations, live slot availability,
 * graph edges, movable blocks — never from a scenario id. The same generator
 * produces interview rebooking, delegation, capacity reclamation and study
 * rebuilds for any graph shaped like this, which is what makes the repair
 * derived rather than scripted (PRD §7).
 *
 * Planned v2 Nemotron proposals enter the same validation pipeline and can
 * never bypass it.
 */

export interface LiveSlot {
  slotId: string;
  startMin: number;
  durationMin: number;
  provenance: string;
}

export interface PlannerInput {
  state: DomainState;
  feasibility: FeasibilityComputation;
  /** Recruiter-approved alternatives that are ALSO currently listed as open. */
  liveSlots: Record<string, LiveSlot[]>;
  /** Planning "now": repairs may not schedule anything before this minute. */
  nowMin: number;
}

export function generateCandidatePlans(input: PlannerInput): CandidatePlan[] {
  const { state, feasibility, liveSlots, nowMin } = input;
  const iso = (m: number) => minutesToIso(m, state.horizonStartIso, state.timezone);

  // ---- Which events need rebooking (buffer violation / unscheduled)? ------
  const rebookTargets = new Set<string>();
  for (const v of feasibility.violations) {
    if (v.type === 'BUFFER_VIOLATION' || v.type === 'UNSCHEDULED') {
      const c = state.commitments[v.commitment_id];
      if (c && c.kind === 'event' && c.flexibility === 'MOVE_WITHIN_WINDOW') {
        rebookTargets.add(c.id);
      }
    }
  }

  // ---- Which windowed tasks need a new owner? -----------------------------
  const delegateTargets: PlannedAction[] = [];
  for (const v of feasibility.violations) {
    if (v.type !== 'ASSIGNEE_UNAVAILABLE') continue;
    const task = state.commitments[v.commitment_id];
    if (!task || task.flexibility !== 'DELEGATABLE') continue;
    const backups = delegationTargets(state, task.id);
    const edge = edgesFrom(state, task.id, 'DELEGATABLE_TO')[0];
    const backup = backups[0];
    if (!backup) continue;
    delegateTargets.push({
      type: 'DELEGATE_TASK',
      target: task.id,
      desired_state: { new_owner: backup },
      provenance: ['user_policy_config', `edge:${edge?.id ?? 'delegatable-to'}`],
      external_system: 'organization',
      summary: `Delegate "${task.title}" to ${state.people[backup]?.name ?? backup}`,
    });
  }

  // ---- Capacity donors: movable blocks occupying focus windows. -----------
  const bindingDeadline = findBindingDeadline(state, feasibility);
  const donors =
    bindingDeadline === undefined ? [] : findCapacityDonors(state, bindingDeadline, nowMin);

  // ---- Interview slot options (earliest-first, from live availability;
  // slots already in the past can never be booked). ------------------------
  const slotOptions: Record<string, LiveSlot[]> = {};
  for (const id of rebookTargets) {
    slotOptions[id] = [...(liveSlots[id] ?? [])]
      .filter((s) => s.startMin >= nowMin)
      .sort((a, b) => a.startMin - b.startMin);
  }

  const plans: CandidatePlan[] = [];

  // Donor subsets ordered by total reclaimed minutes (least disruption first).
  const subsets = donorSubsets(donors);
  for (const [subsetIdx, subset] of subsets.entries()) {
    const rebookActions = buildRebookActions(state, slotOptions, 0, iso);
    if (rebookActions === null) continue; // a rebook is needed but no slot exists
    const donorActions = buildDonorMoves(state, subset, rebookActions.concat(delegateTargets), nowMin, iso);
    const base = [...rebookActions, ...delegateTargets, ...donorActions];
    plans.push(
      assemblePlan(state, `plan-${subsetIdx}-s${firstSlotKey(slotOptions)}`, base, subset, nowMin, iso),
    );
  }

  // Alternative-slot variants of the fullest repair, so the candidate set
  // shows slot alternatives were genuinely evaluated.
  const maxSubset = subsets[subsets.length - 1] ?? [];
  const altCount = Math.max(0, ...Object.values(slotOptions).map((s) => s.length - 1));
  for (let altIdx = 1; altIdx <= altCount; altIdx++) {
    const rebookActions = buildRebookActions(state, slotOptions, altIdx, iso);
    if (rebookActions === null) continue;
    const donorActions = buildDonorMoves(state, maxSubset, rebookActions.concat(delegateTargets), nowMin, iso);
    const base = [...rebookActions, ...delegateTargets, ...donorActions];
    plans.push(
      assemblePlan(state, `plan-${subsets.length}-alt${altIdx}`, base, maxSubset, nowMin, iso),
    );
  }

  // ---- Plan B exhibit: defer the fixed downstream marker instead of
  // delegating. Always rejected (policy: FIXED commitments are immovable) —
  // included so the candidate record shows the option was considered.
  for (const v of feasibility.violations) {
    if (v.type !== 'ASSIGNEE_UNAVAILABLE') continue;
    const task = state.commitments[v.commitment_id];
    if (!task) continue;
    const markerEdge = edgesFrom(state, task.id, 'MUST_PRECEDE')[0];
    const marker = markerEdge ? state.commitments[markerEdge.to] : undefined;
    if (!marker || marker.startMin === undefined) continue;
    const rebookActions = buildRebookActions(state, slotOptions, 0, iso) ?? [];
    const deferred = marker.startMin + 120;
    plans.push(
      assemblePlan(state, 'plan-defer-deliverable', [
        ...rebookActions,
        {
          type: 'MOVE_CALENDAR_EVENT',
          target: marker.id,
          desired_state: {
            start_min: deferred,
            duration_min: marker.durationMin ?? 0,
            start_iso: iso(deferred),
            end_iso: iso(deferred + (marker.durationMin ?? 0)),
          },
          provenance: ['planner-proposal-unbacked'],
          external_system: 'calendar',
          summary: `Defer "${marker.title}" by 2h (no authority)`,
        },
      ], [], nowMin, iso),
    );
    break;
  }

  return plans;
}

function firstSlotKey(slotOptions: Record<string, LiveSlot[]>): string {
  const first = Object.values(slotOptions)[0]?.[0];
  return first ? String(first.startMin) : 'none';
}

function buildRebookActions(
  state: DomainState,
  slotOptions: Record<string, LiveSlot[]>,
  slotIdx: number,
  iso: (m: number) => string,
): PlannedAction[] | null {
  const actions: PlannedAction[] = [];
  for (const [id, slots] of Object.entries(slotOptions)) {
    const slot = slots[Math.min(slotIdx, slots.length - 1)];
    if (!slot) return null; // rebooking required but no live approved slot
    const c = state.commitments[id]!;
    const desired = {
      start_min: slot.startMin,
      duration_min: slot.durationMin,
      start_iso: iso(slot.startMin),
      end_iso: iso(slot.startMin + slot.durationMin),
      slot_id: slot.slotId,
    };
    actions.push({
      type: 'BOOK_INTERVIEW_SLOT',
      target: id,
      desired_state: desired,
      provenance: [slot.provenance],
      external_system: 'recruiter',
      summary: `Book "${c.title}" at ${iso(slot.startMin)}`,
    });
    actions.push({
      type: 'MOVE_CALENDAR_EVENT',
      target: id,
      desired_state: desired,
      provenance: [slot.provenance],
      external_system: 'calendar',
      summary: `Update calendar for "${c.title}" to ${iso(slot.startMin)}`,
    });
  }
  return actions;
}

function findBindingDeadline(
  state: DomainState,
  feasibility: FeasibilityComputation,
): number | undefined {
  let best: { slack: number; deadline: number } | undefined;
  for (const path of feasibility.paths) {
    if (path.kind !== 'capacity' || path.slack_minutes === null) continue;
    const taskId = path.id.replace(/^capacity-/, '');
    const task = state.commitments[taskId];
    if (!task) continue;
    const deadline = effectiveDeadline(state, task);
    if (deadline === undefined) continue;
    if (!best || path.slack_minutes < best.slack) {
      best = { slack: path.slack_minutes, deadline };
    }
  }
  return best?.deadline;
}

function findCapacityDonors(
  state: DomainState,
  bindingDeadline: number,
  nowMin: number,
): Commitment[] {
  return Object.values(state.commitments)
    .filter(
      (c) =>
        c.kind === 'block' &&
        !c.reservesEffortFor &&
        c.owner === state.userId &&
        c.status !== 'DROPPED' &&
        c.status !== 'COMPLETE' &&
        (c.flexibility === 'OPTIONAL' || c.flexibility === 'FLEXIBLE') &&
        c.startMin !== undefined &&
        c.startMin + (c.durationMin ?? 0) > nowMin &&
        c.startMin < bindingDeadline &&
        state.availability.some((w) => overlaps(w, eventInterval(c))),
    )
    .sort((a, b) => (a.durationMin ?? 0) - (b.durationMin ?? 0))
    .slice(0, 4);
}

/** All subsets, ordered by total reclaimed minutes ascending (∅ first). */
function donorSubsets(donors: Commitment[]): Commitment[][] {
  const subsets: Commitment[][] = [];
  for (let mask = 0; mask < 1 << donors.length; mask++) {
    subsets.push(donors.filter((_, i) => mask & (1 << i)));
  }
  return subsets.sort(
    (a, b) =>
      a.reduce((s, c) => s + (c.durationMin ?? 0), 0) -
      b.reduce((s, c) => s + (c.durationMin ?? 0), 0),
  );
}

function buildDonorMoves(
  state: DomainState,
  donors: Commitment[],
  priorActions: PlannedAction[],
  nowMin: number,
  iso: (m: number) => string,
): PlannedAction[] {
  // Relocations are computed against the simulated state so consecutive moves
  // cannot land on top of each other or on the rebooked interview.
  let sim = state;
  for (const a of priorActions) {
    if (a.type !== 'DELEGATE_TASK' && a.type !== 'SEND_NOTIFICATION') sim = applyAction(sim, a);
    else if (a.type === 'DELEGATE_TASK') sim = applyAction(sim, a);
  }
  const actions: PlannedAction[] = [];
  for (const donor of donors) {
    const duration = donor.durationMin ?? 0;
    const disruptedEnd = latestDisruptionEnd(sim) ?? nowMin;
    const start = findRelocationSlot(sim, duration, Math.max(nowMin, disruptedEnd));
    if (start === undefined) continue;
    const action: PlannedAction = {
      type: 'MOVE_CALENDAR_EVENT',
      target: donor.id,
      desired_state: {
        start_min: start,
        duration_min: duration,
        start_iso: iso(start),
        end_iso: iso(start + duration),
      },
      provenance: [`user_policy_config:flexibility=${donor.flexibility}`],
      external_system: 'calendar',
      summary: `Move "${donor.title}" to ${iso(start)}`,
    };
    actions.push(action);
    sim = applyAction(sim, action);
  }
  return actions;
}

/** End of the most urgent hard event — relocations go after the crunch. */
function latestDisruptionEnd(state: DomainState): number | undefined {
  let earliest: number | undefined;
  for (const c of Object.values(state.commitments)) {
    if (c.kind !== 'event' || c.flexibility !== 'FIXED') continue;
    if (c.startMin === undefined || !(c.criticality === 'CRITICAL')) continue;
    const end = c.startMin + (c.durationMin ?? 0);
    if (earliest === undefined || end < earliest) earliest = end;
  }
  return earliest;
}

/**
 * Deterministic relocation search: first 15-minute grid slot (08:00–22:00)
 * that fits the block without touching any scheduled commitment of the user
 * or any declared focus window (moving a block onto focus time would just
 * relocate the capacity problem).
 */
export function findRelocationSlot(
  state: DomainState,
  durationMin: number,
  notBeforeMin: number,
): number | undefined {
  const busy: Interval[] = [];
  for (const c of Object.values(state.commitments)) {
    if (c.status === 'DROPPED' || c.status === 'COMPLETE') continue;
    if (c.owner !== state.userId) continue;
    if (c.startMin === undefined || !(c.durationMin ?? 0)) continue;
    busy.push(eventInterval(c)); // reservations included: they hold real time
  }
  const blocked = [...busy, ...state.availability];

  const start0 = Math.ceil(notBeforeMin / 15) * 15;
  for (let t = start0; t + durationMin <= state.horizonEndMin; t += 15) {
    const dayMin = t % 1440;
    if (dayMin < 8 * 60) continue;
    if (dayMin + durationMin > 22 * 60) continue;
    const candidate: Interval = { start: t, end: t + durationMin };
    if (!blocked.some((b) => overlaps(b, candidate))) return t;
  }
  return undefined;
}

function assemblePlan(
  state: DomainState,
  id: string,
  baseActions: PlannedAction[],
  donorSubset: Commitment[],
  nowMin: number,
  iso: (m: number) => string,
): CandidatePlan {
  // Simulate the base actions, then rebuild the concrete study plan on top.
  let sim = state;
  const notes: string[] = [];
  for (const a of baseActions) {
    try {
      sim = applyAction(sim, a);
    } catch {
      notes.push(`unapplicable action: ${a.summary}`);
    }
  }

  const rebuild: PlannedAction[] = [];
  const invalidatedTaskIds = new Set<string>();
  for (const c of Object.values(sim.commitments)) {
    if (!c.reservesEffortFor || c.status === 'DROPPED') continue;
    const effortTask = sim.commitments[c.reservesEffortFor];
    if (!effortTask || c.startMin === undefined) continue;
    const deadline = effectiveDeadline(sim, effortTask);
    const invalid =
      (deadline !== undefined && c.startMin + (c.durationMin ?? 0) > deadline) ||
      c.startMin < nowMin;
    if (invalid) {
      invalidatedTaskIds.add(c.reservesEffortFor);
      rebuild.push({
        type: 'DELETE_CALENDAR_EVENT',
        target: c.id,
        desired_state: { reason: 'reservation invalidated by mutation' },
        provenance: ['user_policy_config:study-plan'],
        external_system: 'calendar',
        summary: `Remove invalidated block "${c.title}" (${iso(c.startMin)})`,
      });
    }
  }
  if (invalidatedTaskIds.size > 0) {
    const simWithoutInvalid = structuredClone(sim);
    for (const c of Object.values(simWithoutInvalid.commitments)) {
      if (c.reservesEffortFor && invalidatedTaskIds.has(c.reservesEffortFor)) {
        c.status = 'DROPPED';
      }
    }
    const { sessions, unplacedMinutes } = scheduleEffort(simWithoutInvalid, [
      { start: 0, end: nowMin },
    ]);
    let n = 0;
    for (const s of sessions) {
      if (!invalidatedTaskIds.has(s.taskId)) continue;
      const task = sim.commitments[s.taskId]!;
      n += 1;
      rebuild.push({
        type: 'CREATE_CALENDAR_EVENT',
        target: `study-${s.taskId}-${n}`,
        desired_state: {
          title: `Study: ${task.title}`,
          start_min: s.interval.start,
          duration_min: s.interval.end - s.interval.start,
          start_iso: iso(s.interval.start),
          end_iso: iso(s.interval.end),
          reserves_effort_for: s.taskId,
        },
        provenance: ['user_policy_config:study-plan'],
        external_system: 'calendar',
        summary: `Reserve ${s.workMinutes} min for "${task.title}" at ${iso(s.interval.start)}`,
      });
    }
    for (const [taskId, minutes] of Object.entries(unplacedMinutes)) {
      notes.push(`unplaced effort: ${taskId} short ${minutes} min`);
    }
  }

  const label = describePlan(baseActions, donorSubset);
  return {
    id,
    label,
    actions: [...baseActions, ...rebuild],
    notes,
  };
}

function describePlan(actions: PlannedAction[], donors: Commitment[]): string {
  const parts: string[] = [];
  if (actions.some((a) => a.type === 'BOOK_INTERVIEW_SLOT')) parts.push('rebook interview');
  if (actions.some((a) => a.type === 'DELEGATE_TASK')) parts.push('delegate QA');
  if (actions.some((a) => a.type === 'MOVE_CALENDAR_EVENT' && a.provenance[0] === 'planner-proposal-unbacked')) {
    parts.push('defer deliverable');
  }
  for (const d of donors) parts.push(`move ${d.title.toLowerCase()}`);
  parts.push('rebuild study plan');
  return parts.join(' + ');
}

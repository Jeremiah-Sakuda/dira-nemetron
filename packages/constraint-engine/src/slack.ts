import {
  type Commitment,
  type DomainState,
  type Interval,
  edgesFrom,
  edgesTo,
  eventInterval,
  overlaps,
  remainingEffortMin,
  subtractIntervals,
} from '@dira/commitment-model';
import type { FeasibilityResult, Violation } from '@dira/event-schema';
import { capacityBefore, freeSegments, isSchedulable } from './capacity.js';

/**
 * Formal Global Slack (PRD §16).
 *
 * The solver partitions required work into:
 *
 *  1. POOLED EFFORT (exam prep, problem sets): tasks drawing on the shared
 *     pool of the user's free focus time before a hard deadline. Feasibility
 *     uses the classic cumulative earliest-deadline test: for every deadline
 *     d, slack(d) = usable_capacity(≤ d) − Σ remaining_effort(deadline ≤ d).
 *     A negative bucket means no schedule exists that meets that deadline.
 *
 *  2. WINDOWED TASKS (visual QA between asset-arrival and deck-freeze): short
 *     tasks that must be *placed* as one session inside [release, deadline]
 *     for a specific owner. They consume owner capacity as busy blocks.
 *
 *  3. BUFFER / ORDERING constraints between scheduled events.
 *
 * Global Slack = minimum over all capacity buckets and applicable buffer
 * constraints — the safety margin of the single most constrained critical
 * path. Aggregate free time can never mask one impossible deadline.
 */

export interface SlackPath {
  id: string;
  label: string;
  slack_minutes: number | null;
  kind: 'capacity' | 'buffer' | 'assignment';
}

export interface WindowedPlacement {
  commitmentId: string;
  owner: string;
  interval: Interval | null; // null → no feasible placement for this owner
  valid: boolean;
}

/** Effective deadline of a pooled effort task, derived from graph edges. */
export function effectiveDeadline(state: DomainState, task: Commitment): number | undefined {
  let deadline = task.deadlineMin;
  // REQUIRES_PREPARATION: event → prep task. Prep must finish before the
  // event starts, minus any configured final buffer.
  for (const e of edgesTo(state, task.id, 'REQUIRES_PREPARATION')) {
    const event = state.commitments[e.from];
    if (!event || event.startMin === undefined || !isSchedulable(event)) continue;
    const d = event.startMin - (e.data?.finalBufferMin ?? 0);
    deadline = deadline === undefined ? d : Math.min(deadline, d);
  }
  return deadline;
}

/** Effective release/deadline window of a windowed task, derived from edges. */
export function effectiveWindow(
  state: DomainState,
  task: Commitment,
): { release: number; deadline: number } | undefined {
  let release = task.releaseMin;
  let deadline = task.deadlineMin;
  for (const e of edgesFrom(state, task.id, 'MUST_FOLLOW')) {
    const marker = state.commitments[e.to];
    if (marker?.startMin === undefined) continue;
    const r = marker.startMin + (marker.durationMin ?? 0);
    release = release === undefined ? r : Math.max(release, r);
  }
  for (const e of edgesFrom(state, task.id, 'MUST_PRECEDE')) {
    const marker = state.commitments[e.to];
    if (marker?.startMin === undefined) continue;
    deadline = deadline === undefined ? marker.startMin : Math.min(deadline, marker.startMin);
  }
  if (release === undefined || deadline === undefined) return undefined;
  return { release, deadline };
}

function isWindowedTask(state: DomainState, c: Commitment): boolean {
  return c.kind === 'effort' && effectiveWindow(state, c) !== undefined;
}

function isPooledTask(state: DomainState, c: Commitment): boolean {
  return (
    c.kind === 'effort' &&
    isSchedulable(c) &&
    !isWindowedTask(state, c) &&
    remainingEffortMin(c) > 0 &&
    c.owner === state.userId
  );
}

/**
 * Try to place a windowed task for its owner: a single contiguous session of
 * `effort + overhead` minutes inside [release, deadline], within the owner's
 * availability, avoiding the owner's busy time. Earliest feasible start wins.
 */
export function placeWindowedTask(
  state: DomainState,
  task: Commitment,
  extraBusy: Interval[] = [],
): WindowedPlacement {
  const window = effectiveWindow(state, task);
  const effort = remainingEffortMin(task);
  const overhead = state.config.sessionOverheadMin;
  if (!window) return { commitmentId: task.id, owner: task.owner, interval: null, valid: false };

  const ownerAvailability =
    task.owner === state.userId
      ? state.availability
      : state.people[task.owner]?.availability ?? [];

  // Owner busy time: for the user, all scheduled non-reservation commitments;
  // for other people we only know what the org tools tell us (availability).
  const busy: Interval[] = [...extraBusy];
  for (const c of Object.values(state.commitments)) {
    if (!isSchedulable(c) || c.id === task.id) continue;
    if (c.owner !== task.owner) continue;
    if (c.reservesEffortFor) continue;
    if (c.startMin === undefined || !c.durationMin) continue;
    busy.push(eventInterval(c));
  }

  const windowIv: Interval = { start: window.release, end: window.deadline };
  for (const avail of ownerAvailability) {
    const clipped: Interval = {
      start: Math.max(avail.start, windowIv.start),
      end: Math.min(avail.end, windowIv.end),
    };
    if (clipped.end <= clipped.start) continue;
    for (const free of subtractIntervals(clipped, busy)) {
      if (free.end - free.start >= effort + overhead) {
        return {
          commitmentId: task.id,
          owner: task.owner,
          interval: { start: free.start, end: free.start + effort + overhead },
          valid: true,
        };
      }
    }
  }
  return { commitmentId: task.id, owner: task.owner, interval: null, valid: false };
}

export interface FeasibilityComputation extends FeasibilityResult {
  paths: SlackPath[];
  placements: WindowedPlacement[];
  segments: Interval[];
}

export function computeFeasibility(state: DomainState): FeasibilityComputation {
  const overhead = state.config.sessionOverheadMin;
  const violations: Violation[] = [];
  const paths: SlackPath[] = [];
  const placements: WindowedPlacement[] = [];
  const user = state.userId;

  const all = Object.values(state.commitments).filter(isSchedulable);

  // ---- 1. Windowed tasks: validate stored placement or find one. -----------
  // Placements accumulate per owner so two windowed tasks can never be
  // assigned the same minutes.
  const windowedBusy: Interval[] = [];
  const placedByOwner = new Map<string, Interval[]>();
  for (const task of all.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    if (!isWindowedTask(state, task)) continue;
    const window = effectiveWindow(state, task)!;
    const effort = remainingEffortMin(task);
    if (effort <= 0) continue;

    const ownerPlaced = placedByOwner.get(task.owner) ?? [];
    let placement: WindowedPlacement;
    const stored: Interval | null =
      task.startMin !== undefined && task.durationMin
        ? { start: task.startMin, end: task.startMin + task.durationMin }
        : null;

    const ownerAvailability =
      task.owner === state.userId
        ? state.availability
        : state.people[task.owner]?.availability ?? [];
    const storedValid =
      stored !== null &&
      stored.start >= window.release &&
      stored.end <= window.deadline &&
      // The session must be long enough for the remaining work…
      stored.end - stored.start >= effort &&
      // …sit inside the owner's real availability…
      ownerAvailability.some((w) => stored.start >= w.start && stored.end <= w.end) &&
      // …and collide with neither the owner's events nor earlier placements.
      !conflictsWithOwnerEvents(state, task, stored) &&
      !ownerPlaced.some((p) => overlaps(p, stored));

    if (storedValid) {
      placement = { commitmentId: task.id, owner: task.owner, interval: stored, valid: true };
    } else {
      placement = placeWindowedTask(state, task, ownerPlaced);
    }
    if (placement.valid && placement.interval) {
      placedByOwner.set(task.owner, [...ownerPlaced, placement.interval]);
    }
    placements.push(placement);

    if (!placement.valid) {
      violations.push({
        type: 'ASSIGNEE_UNAVAILABLE',
        commitment_id: task.id,
        detail:
          `${task.title}: no feasible session for ${task.owner === state.userId ? 'you' : state.people[task.owner]?.name ?? task.owner} ` +
          `within its execution window`,
      });
      paths.push({
        id: `assignment-${task.id}`,
        label: `${task.title} — assignment`,
        slack_minutes: null,
        kind: 'assignment',
      });
    } else {
      // Latitude = how far the placement could still slide within the window.
      const latitude = window.deadline - placement.interval!.end;
      paths.push({
        id: `assignment-${task.id}`,
        label: `${task.title} — assignment (${task.owner})`,
        slack_minutes: latitude,
        kind: 'assignment',
      });
      if (task.owner === user) windowedBusy.push(placement.interval!);
    }
  }

  // ---- 2. Pooled effort: cumulative earliest-deadline capacity buckets. ----
  const segments = freeSegments(state, windowedBusy);
  const pooled = all
    .map((c) => ({ task: c, deadline: isPooledTask(state, c) ? effectiveDeadline(state, c) : undefined }))
    .filter((x): x is { task: Commitment; deadline: number } => x.deadline !== undefined)
    .sort((a, b) => a.deadline - b.deadline);

  const bucketSlacks: number[] = [];
  for (const { task, deadline } of pooled) {
    const cap = capacityBefore(segments, deadline, overhead);
    const demand = pooled
      .filter((p) => p.deadline <= deadline)
      .reduce((sum, p) => sum + remainingEffortMin(p.task), 0);
    const slack = cap - demand;
    bucketSlacks.push(slack);

    // Attribute prep-capacity shortfalls to the prepared event (PRD §18).
    const prepEdge = edgesTo(state, task.id, 'REQUIRES_PREPARATION')[0];
    const attributed = prepEdge ? prepEdge.from : task.id;
    paths.push({
      id: `capacity-${task.id}`,
      label: `${task.title} — capacity path`,
      slack_minutes: slack,
      kind: 'capacity',
    });
    if (slack < 0) {
      violations.push({
        type: prepEdge ? 'INSUFFICIENT_PREP_CAPACITY' : 'INSUFFICIENT_CAPACITY',
        commitment_id: attributed,
        detail:
          `${task.title}: ${demand} min of required work vs ${cap} min of usable ` +
          `capacity before its deadline`,
        deficit_minutes: -slack,
      });
    }
  }

  // ---- 3. Buffer constraints between scheduled events. ---------------------
  for (const e of state.edges) {
    if (e.type !== 'REQUIRES_BUFFER') continue;
    const a = state.commitments[e.from];
    const b = state.commitments[e.to];
    if (!a || !b || !isSchedulable(a) || !isSchedulable(b)) continue;
    if (a.startMin === undefined || b.startMin === undefined) continue;
    const buffer = e.data?.bufferMin ?? 0;
    const aEnd = a.startMin + (a.durationMin ?? 0);
    // Only applicable when A occurs before B: the buffer protects recovery
    // time after A before B may begin.
    if (b.startMin + (b.durationMin ?? 0) <= a.startMin) {
      paths.push({
        id: `buffer-${e.id}`,
        label: `${a.title} → ${b.title} buffer (not applicable)`,
        slack_minutes: null,
        kind: 'buffer',
      });
      continue;
    }
    const slack = b.startMin - aEnd - buffer;
    paths.push({
      id: `buffer-${e.id}`,
      label: `${a.title} → ${b.title} buffer`,
      slack_minutes: slack,
      kind: 'buffer',
    });
    if (slack < 0) {
      violations.push({
        type: 'BUFFER_VIOLATION',
        commitment_id: b.id,
        detail:
          `${b.title} starts ${b.startMin - aEnd} min after ${a.title} ends; ` +
          `${buffer} min required (${e.data?.provenance ?? 'stored constraint'})`,
        deficit_minutes: -slack,
      });
    }
  }

  // ---- 4. Hard overlaps between the user's scheduled commitments. ----------
  // Events and real blocks alike: a plan that moves a block onto an event is
  // a hard violation, not a quiet double-booking.
  const scheduled = all.filter(
    (c) =>
      c.owner === user &&
      c.startMin !== undefined &&
      (c.durationMin ?? 0) > 0 &&
      !c.reservesEffortFor &&
      (c.kind === 'event' || c.kind === 'block'),
  );
  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const a = scheduled[i]!;
      const b = scheduled[j]!;
      if (overlaps(eventInterval(a), eventInterval(b))) {
        violations.push({
          type: 'OVERLAP',
          commitment_id: b.id,
          detail: `${a.title} overlaps ${b.title}`,
        });
      }
    }
  }

  // ---- 4b. Critical events that lost their scheduled time entirely. --------
  for (const c of all) {
    if (c.kind !== 'event' || c.owner !== user) continue;
    if (c.startMin === undefined && (c.criticality === 'CRITICAL' || c.criticality === 'HIGH')) {
      violations.push({
        type: 'UNSCHEDULED',
        commitment_id: c.id,
        detail: `${c.title} has no confirmed time`,
      });
    }
  }

  // ---- 5. Ordering edges between scheduled commitments. --------------------
  for (const e of state.edges) {
    if (e.type !== 'MUST_PRECEDE' && e.type !== 'MUST_FOLLOW') continue;
    const a = state.commitments[e.from];
    const b = state.commitments[e.to];
    if (!a || !b || !isSchedulable(a) || !isSchedulable(b)) continue;
    if (a.kind === 'effort' || b.kind === 'effort') continue; // handled as windows
    if (a.startMin === undefined || b.startMin === undefined) continue;
    const aEnd = a.startMin + (a.durationMin ?? 0);
    const bEnd = b.startMin + (b.durationMin ?? 0);
    const ok = e.type === 'MUST_PRECEDE' ? aEnd <= b.startMin : a.startMin >= bEnd;
    if (!ok) {
      violations.push({
        type: 'ORDERING_VIOLATION',
        commitment_id: e.from,
        detail: `${a.title} must ${e.type === 'MUST_PRECEDE' ? 'precede' : 'follow'} ${b.title}`,
      });
    }
  }

  // ---- 6. Dependencies: a dependent cannot survive a dropped prerequisite. -
  for (const e of state.edges) {
    if (e.type !== 'DEPENDS_ON') continue;
    const dependent = state.commitments[e.from];
    const prereq = state.commitments[e.to];
    if (!dependent || !prereq || !isSchedulable(dependent)) continue;
    if (prereq.status === 'DROPPED') {
      violations.push({
        type: 'DEPENDENCY_UNSATISFIED',
        commitment_id: dependent.id,
        detail: `${dependent.title} depends on dropped ${prereq.title}`,
      });
    }
  }

  // ---- Global slack: minimum over capacity buckets and applicable buffers.
  // With no constrained paths at all, slack is unbounded; we report the
  // horizon length as its finite stand-in (slack can never exceed it, since
  // usable capacity is a strict subset of the horizon).
  const numeric = paths
    .filter((p) => p.kind !== 'assignment' && p.slack_minutes !== null)
    .map((p) => p.slack_minutes as number);
  const globalSlack = numeric.length ? Math.min(...numeric) : state.horizonEndMin;

  return {
    feasible: violations.length === 0,
    global_slack_minutes: globalSlack,
    violations,
    paths,
    placements,
    segments,
  };
}

function conflictsWithOwnerEvents(
  state: DomainState,
  task: Commitment,
  interval: Interval,
): boolean {
  for (const c of Object.values(state.commitments)) {
    if (!isSchedulable(c) || c.id === task.id) continue;
    if (c.owner !== task.owner) continue;
    if (c.reservesEffortFor) continue;
    if (c.startMin === undefined || !c.durationMin) continue;
    if (overlaps(eventInterval(c), interval)) return true;
  }
  return false;
}

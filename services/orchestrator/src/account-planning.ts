import { z } from 'zod';
import { isoToMinutes, localDateTimeToIso, type DomainState, type Interval } from '@dira/commitment-model';
import { computeFeasibility, rankValidations, validatePlan } from '@dira/constraint-engine';
import { evaluatePlanActions } from '@dira/policy-engine';
import { generateCandidatePlans } from '@dira/agent';

export const AvailabilityProfileSchema = z.object({
  weekdays: z.array(z.number().int().min(0).max(6)).max(7)
    .refine((days) => new Set(days).size === days.length, 'Choose each weekday once.'),
  startMinute: z.number().int().min(0).max(1380),
  endMinute: z.number().int().min(60).max(1440),
}).strict().refine((profile) => profile.endMinute - profile.startMinute >= 60, {
  message: 'Focus time must be at least one hour.',
  path: ['endMinute'],
});

export type AvailabilityProfile = z.infer<typeof AvailabilityProfileSchema>;

/** Convert a user's recurring local focus hours into absolute solver intervals. */
export function availabilityIntervals(
  profile: AvailabilityProfile,
  state: DomainState,
  now = new Date(),
): Interval[] {
  const timezone = state.timezone ?? 'UTC';
  const startIso = now.toISOString();
  const startMin = isoToMinutes(startIso, state.horizonStartIso);
  const horizonEnd = state.horizonEndMin;
  const today = localDate(now, timezone);
  const days = new Set(profile.weekdays);
  const intervals: Interval[] = [];

  for (let offset = 0; offset < 91; offset += 1) {
    const date = addDays(today, offset);
    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    if (!days.has(day)) continue;
    const endLocalDate = profile.endMinute === 1440 ? addDays(date, 1) : date;
    const endClock = profile.endMinute === 1440 ? '00:00' : clock(profile.endMinute);
    let start: number;
    let end: number;
    try {
      start = isoToMinutes(localDateTimeToIso(`${date}T${clock(profile.startMinute)}`, timezone), state.horizonStartIso);
      end = isoToMinutes(localDateTimeToIso(`${endLocalDate}T${endClock}`, timezone), state.horizonStartIso);
    } catch {
      // A user-selected wall-clock time can be skipped by a DST transition.
      // Omit that one day's window; the profile remains valid for other weeks.
      continue;
    }
    const clipped = { start: Math.max(start, startMin, 0), end: Math.min(end, horizonEnd) };
    if (clipped.end > clipped.start) intervals.push(clipped);
  }
  return intervals;
}

/** Re-anchor the relative solver horizon without changing any absolute date. */
export function rebaseDomainState(state: DomainState, now = new Date()): DomainState {
  const next = structuredClone(state);
  const nowIso = now.toISOString();
  const elapsedMin = isoToMinutes(nowIso, state.horizonStartIso);
  for (const commitment of Object.values(next.commitments)) {
    if (commitment.startMin !== undefined) commitment.startMin -= elapsedMin;
    if (commitment.deadlineMin !== undefined) commitment.deadlineMin -= elapsedMin;
    if (commitment.releaseMin !== undefined) commitment.releaseMin -= elapsedMin;
  }
  for (const [id, slots] of Object.entries(next.approvedSlots)) {
    const remaining = slots
      .map((slot) => ({ ...slot, startMin: slot.startMin - elapsedMin }))
      .filter((slot) => slot.startMin >= 0 && slot.startMin < 90 * 24 * 60);
    if (remaining.length) next.approvedSlots[id] = remaining;
    else delete next.approvedSlots[id];
  }
  next.horizonStartIso = nowIso;
  next.horizonEndMin = 90 * 24 * 60;
  next.availability = [];
  return next;
}

export function analyzeAccountSchedule(state: DomainState) {
  const feasibility = computeFeasibility(state);
  const nowMin = Math.max(0, isoToMinutes(new Date().toISOString(), state.horizonStartIso));
  const candidates = generateCandidatePlans({ state, feasibility, liveSlots: {}, nowMin });
  const validations = candidates.map((plan) => validatePlan(state, plan));
  const ranked = rankValidations(validations);
  const plans = ranked.slice(0, 5).map((validation) => {
    const policy = evaluatePlanActions(state, validation.plan.actions);
    return {
      id: validation.plan.id,
      label: validation.plan.label,
      acceptable: validation.acceptable && policy.autonomous,
      rejectionReason: !policy.autonomous
        ? policy.decisions.find((decision) => decision.verdict === 'DENY' || decision.verdict === 'REQUIRE_APPROVAL')?.reason
        : validation.rejectionReason,
      slackMinutes: validation.feasibility.global_slack_minutes,
      actions: validation.plan.actions.map((action) => ({ summary: action.summary, type: action.type })),
    };
  });
  return {
    feasibility: {
      globalSlackMinutes: feasibility.global_slack_minutes,
      violations: feasibility.violations,
      paths: feasibility.paths,
      placements: feasibility.placements,
    },
    plans,
    checkedAtIso: new Date().toISOString(),
  };
}

function localDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
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

import { isoToMinutes } from '@dira/commitment-model';
import type { PlannedAction } from '@dira/event-schema';
/**
 * Relative offsets are derived from the complete approved interval. Callers
 * cannot reuse stale offsets after a horizon rebase, or execute a partial intent.
 * Absolute instants and the persisted action remain unchanged.
 */
export function normalizeActionTimes(action: PlannedAction, horizonStartIso: string): PlannedAction {
  const normalized = structuredClone(action);
  if (!['CREATE_CALENDAR_EVENT','MOVE_CALENDAR_EVENT','BOOK_INTERVIEW_SLOT'].includes(action.type)) return normalized;
  const d = normalized.desired_state;
  if (typeof d.start_iso !== 'string' || !Number.isFinite(Date.parse(d.start_iso))) {
    throw new Error('Scheduled action is missing an absolute start');
  }
  if (typeof d.end_iso !== 'string' || !Number.isFinite(Date.parse(d.end_iso))) {
    throw new Error('Scheduled action is missing an absolute end');
  }
  if (Date.parse(d.end_iso) <= Date.parse(d.start_iso)) {
    throw new Error('Scheduled action must end after its start');
  }
  const startMin = isoToMinutes(d.start_iso, horizonStartIso);
  const durationMin = isoToMinutes(d.end_iso, horizonStartIso) - startMin;
  if (durationMin <= 0) throw new Error('Scheduled action must occupy at least one planning minute');
  d.start_min = startMin;
  d.duration_min = durationMin;
  return normalized;
}

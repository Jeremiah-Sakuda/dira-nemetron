import { isoToMinutes } from '@dira/commitment-model';
import type { PlannedAction } from '@dira/event-schema';
/** Relative offsets are derived; approved absolute instants remain unchanged. */
export function normalizeActionTimes(action: PlannedAction, horizonStartIso: string): PlannedAction {
  const normalized=structuredClone(action);
  if (!['CREATE_CALENDAR_EVENT','MOVE_CALENDAR_EVENT','BOOK_INTERVIEW_SLOT'].includes(action.type)) return normalized;
  const d=normalized.desired_state;
  if (typeof d.start_iso !== 'string' || !Number.isFinite(Date.parse(d.start_iso))) throw new Error('Scheduled action is missing an absolute start');
  d.start_min=isoToMinutes(d.start_iso,horizonStartIso);
  if (typeof d.end_iso === 'string') d.duration_min=isoToMinutes(d.end_iso,horizonStartIso)-Number(d.start_min);
  return normalized;
}

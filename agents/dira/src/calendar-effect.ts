import type { PlannedAction } from '@dira/event-schema';
import type { CalendarEvent, CalendarTool } from '@dira/tool-contracts';

/**
 * Fresh read-back of an approved Calendar effect. Provider identity resolution
 * belongs to the adapter; complete intent comparison belongs here, independently
 * of whether the adapter implements optional query filters.
 */
export async function verifyCalendarEffect(
  calendar: Pick<CalendarTool, 'verifyEvent'>,
  eventId: string,
  action: Pick<PlannedAction, 'type' | 'desired_state'>,
): Promise<{ ok: boolean; observed: CalendarEvent | null }> {
  if (!['CREATE_CALENDAR_EVENT', 'MOVE_CALENDAR_EVENT', 'DELETE_CALENDAR_EVENT'].includes(action.type)) {
    throw new Error(`Not a Calendar effect: ${action.type}`);
  }
  const observed = await calendar.verifyEvent({ id: eventId });
  if (action.type === 'DELETE_CALENDAR_EVENT') return { ok: observed === null, observed };
  const desired = action.desired_state;
  const start = typeof desired.start_iso === 'string' ? Date.parse(desired.start_iso) : NaN;
  const end = typeof desired.end_iso === 'string' ? Date.parse(desired.end_iso) : NaN;
  return {
    ok: observed !== null && Number.isFinite(start) && Number.isFinite(end) && end > start
      && Date.parse(observed.startIso) === start && Date.parse(observed.endIso) === end
      && (typeof desired.title !== 'string' || observed.title === desired.title),
    observed,
  };
}

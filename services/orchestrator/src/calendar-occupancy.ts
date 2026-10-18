import { isoToMinutes, localDateTimeToIso, type DomainState } from '@dira/commitment-model';
import type { GoogleUserCalendarTool } from '@dira/adapter-calendar/user-google';

/** Unknown source items block execution until reviewed. They never become
 * confirmed commitments merely because an approval preflight observed them. */
export async function assertReviewedCalendarOccupancy(
  calendar: Pick<GoogleUserCalendarTool, 'getEventsInWindow'>,
  state: DomainState,
  allowedCreatedIds: readonly string[] = [],
): Promise<number> {
  const start = Math.max(Date.now(), Date.parse(state.horizonStartIso));
  const end = Date.parse(state.horizonStartIso) + state.horizonEndMin * 60000;
  if (end <= start) throw new Error('Calendar planning horizon expired; refresh your schedule.');
  const events = await calendar.getEventsInWindow(new Date(start).toISOString(), new Date(end).toISOString());
  const reviewed = new Set(Object.values(state.commitments)
    .filter(c => c.externalSystem === 'calendar' && c.status !== 'DROPPED' && c.status !== 'COMPLETE' && c.externalId)
    .map(c => c.externalId!));
  const allowed = new Set(allowedCreatedIds);
  const bySource = new Map(Object.values(state.commitments).filter(c => c.externalId && reviewed.has(c.externalId)).map(c => [c.externalId!, c]));
  const minute = (value: string) => isoToMinutes(/^\d{4}-\d{2}-\d{2}$/.test(value)
    ? localDateTimeToIso(`${value}T00:00`, state.timezone ?? 'UTC') : value, state.horizonStartIso);
  for (const event of events) {
    if (event.metadata?.transparency === 'transparent' || event.metadata?.status === 'cancelled') continue;
    const externalId = event.metadata?.googleEventId ?? event.id.replace(/^google:/, '');
    if (!reviewed.has(externalId) && !allowed.has(event.id)) {
      throw new Error('Calendar contains unreviewed busy time in the planning horizon. Sync Calendar changes and review before executing this plan.');
    }
    const commitment = bySource.get(externalId);
    if (commitment?.startMin !== undefined && (minute(event.startIso) !== commitment.startMin
      || minute(event.endIso) !== commitment.startMin + (commitment.durationMin ?? 0))) {
      throw new Error('Calendar busy time changed after review. Sync Calendar changes and request a fresh plan.');
    }
  }
  return events.length;
}

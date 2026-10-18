import type { CalendarEvent } from '@dira/tool-contracts';

/** Provider identity is distinct from Dira's logical/idempotency identity. */
export interface CalendarExecutionReceipt { kind: 'google-calendar'; googleEventId: string; logicalId: string }
export function calendarProviderId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  const metadata = item.metadata as Record<string, unknown> | undefined;
  if (typeof metadata?.googleEventId === 'string' && metadata.googleEventId) return metadata.googleEventId;
  if (typeof item.googleEventId === 'string' && item.googleEventId) return item.googleEventId;
  // Legacy insertion receipts contained only the provider's id. CalendarEvent
  // reads have startIso/metadata and their `id` can instead be the logical id.
  if (!('startIso' in item) && !('metadata' in item) && typeof item.id === 'string' && item.id) return item.id;
  return undefined;
}
export function calendarReceipt(event: CalendarEvent, logicalId: string): CalendarExecutionReceipt {
  const googleEventId = calendarProviderId(event);
  if (!googleEventId || event.id !== logicalId) throw new Error('Calendar read-back identity does not match the approved create');
  return { kind: 'google-calendar', googleEventId, logicalId };
}

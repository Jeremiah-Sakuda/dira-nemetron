import { describe, expect, it, vi } from 'vitest';
import { verifyCalendarEffect } from '@dira/agent';
import type { CalendarEvent } from '@dira/tool-contracts';

const desired = { title: '', start_iso: '2030-01-02T10:00:00Z', end_iso: '2030-01-02T11:00:00Z' };
const event: CalendarEvent = { id: 'provider-logical-reference', title: '', startIso: '2030-01-02T05:00:00-05:00', endIso: '2030-01-02T06:00:00-05:00' };

describe('Calendar effect read-back interface', () => {
  it.each(['CREATE_CALENDAR_EVENT', 'MOVE_CALENDAR_EVENT'] as const)('freshly verifies every %s field using equivalent instants', async type => {
    const verifyEvent = vi.fn().mockResolvedValue(event);
    const result = await verifyCalendarEffect({ verifyEvent }, 'google:provider-reference', { type, desired_state: desired });
    expect(verifyEvent).toHaveBeenCalledExactlyOnceWith({ id: 'google:provider-reference' });
    expect(result).toEqual({ ok: true, observed: event });
  });

  it.each([
    null,
    { ...event, startIso: '2030-01-02T10:01:00Z' },
    { ...event, endIso: 'invalid' },
    { ...event, endIso: '2030-01-02T11:01:00Z' },
    { ...event, title: 'An empty approved title still matters' },
  ])('rejects a missing or mismatched observation %#', async observed => {
    const result = await verifyCalendarEffect({ verifyEvent: async () => observed }, 'synthetic', { type: 'MOVE_CALENDAR_EVENT', desired_state: desired });
    expect(result).toEqual({ ok: false, observed });
  });

  it.each([null, event])('requires independently observed absence for deletion %#', async observed => {
    const result = await verifyCalendarEffect({ verifyEvent: async () => observed }, 'synthetic', { type: 'DELETE_CALENDAR_EVENT', desired_state: {} });
    expect(result.ok).toBe(observed === null);
  });

  it.each([undefined, 'invalid', desired.start_iso, '2030-01-02T09:00:00Z'])('rejects invalid approved intervals: %s', async end_iso => {
    const result = await verifyCalendarEffect({ verifyEvent: async () => event }, 'synthetic', { type: 'CREATE_CALENDAR_EVENT', desired_state: { ...desired, end_iso } });
    expect(result.ok).toBe(false);
  });

  it('preserves a read failure instead of treating it as deletion', async () => {
    await expect(verifyCalendarEffect({ verifyEvent: async () => { throw new Error('unavailable'); } }, 'synthetic', { type: 'DELETE_CALENDAR_EVENT', desired_state: {} })).rejects.toThrow('unavailable');
  });
});

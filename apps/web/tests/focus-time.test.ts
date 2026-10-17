import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatFocusTime } from '../lib/focus-time.js';
afterEach(() => vi.unstubAllEnvs());
describe('recurring focus-hour labels', () => {
  it.each(['UTC', 'America/New_York', 'Asia/Tokyo'])('keeps wall-clock choices unchanged in %s', (timezone) => {
    vi.stubEnv('TZ', timezone);
    expect(formatFocusTime(540)).toBe('9:00 AM');
    expect(formatFocusTime(1020)).toBe('5:00 PM');
    expect(formatFocusTime(0)).toBe('12:00 AM');
    expect(formatFocusTime(1440)).toBe('12:00 AM (next day)');
  });
});

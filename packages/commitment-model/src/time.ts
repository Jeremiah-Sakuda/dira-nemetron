/**
 * Time utilities.
 *
 * Engine arithmetic uses absolute instants represented as integer minutes
 * from the horizon start. IANA timezones are applied only when formatting at
 * the boundary. Legacy fixtures without a timezone retain their input offset.
 */

export const DEMO_UTC_OFFSET = '-05:00';

/** Minutes since the given horizon start for an ISO-8601 timestamp. */
export function isoToMinutes(iso: string, horizonStartIso: string): number {
  const ms = Date.parse(iso) - Date.parse(horizonStartIso);
  if (Number.isNaN(ms)) throw new Error(`Unparseable timestamp: ${iso}`);
  return Math.round(ms / 60_000);
}

/** ISO-8601 timestamp (fixed demo offset) for minutes past the horizon start. */
export function minutesToIso(minutes: number, horizonStartIso: string, timeZone?: string): string {
  const startMs = Date.parse(horizonStartIso);
  const d = new Date(startMs + minutes * 60_000);
  const offsetMin = timeZone ? timezoneOffsetMinutes(d, timeZone) : offsetMinutesFromIso(horizonStartIso);
  const local = new Date(d.getTime() + offsetMin * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const absOffset = Math.abs(offsetMin);
  const offset = `${offsetMin < 0 ? '-' : '+'}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`;
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:00${offset}`
  );
}

/** Pretty "Wed 14:00" label for logs and the flight recorder. */
export function minutesToLabel(minutes: number, horizonStartIso: string, timeZone?: string): string {
  const iso = minutesToIso(minutes, horizonStartIso, timeZone);
  const date = new Date(Date.parse(iso));
  const localDate = new Date(Date.UTC(
    Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)),
  ));
  const weekday = timeZone
    ? new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date)
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][localDate.getUTCDay()];
  return `${weekday} ${iso.slice(11, 16)}`;
}

function timezoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localAsUtc = Date.UTC(
    Number(values.year), Number(values.month) - 1, Number(values.day),
    Number(values.hour), Number(values.minute), Number(values.second),
  );
  return Math.round((localAsUtc - date.getTime()) / 60_000);
}

function offsetMinutesFromIso(iso: string): number {
  const suffix = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  if (!suffix) return 0;
  const minutes = Number(suffix[2]) * 60 + Number(suffix[3]);
  return suffix[1] === '-' ? -minutes : minutes;
}

/** Format a signed minute count as hours with one decimal, e.g. +4.1h / -3.6h. */
export function formatSlackHours(minutes: number): string {
  const hours = minutes / 60;
  const sign = hours >= 0 ? '+' : '';
  return `${sign}${hours.toFixed(1)}h`;
}

export interface Interval {
  /** inclusive start, minutes from horizon start */
  start: number;
  /** exclusive end, minutes from horizon start */
  end: number;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Subtract a set of busy intervals from a window, returning free segments. */
export function subtractIntervals(window: Interval, busy: Interval[]): Interval[] {
  const sorted = [...busy]
    .filter((b) => overlaps(window, b))
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  let cursor = window.start;
  for (const b of sorted) {
    if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, window.end) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= window.end) break;
  }
  if (cursor < window.end) out.push({ start: cursor, end: window.end });
  return out.filter((s) => s.end > s.start);
}

/** Merge touching/overlapping intervals. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}

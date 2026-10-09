import { createHash } from 'node:crypto';
import { localDateTimeToIso } from '@dira/commitment-model';

export interface IcalEvent {
  uid: string;
  title: string;
  startIso: string;
  endIso: string;
  version: string;
}

export interface ParsedIcalFeed {
  events: Record<string, IcalEvent>;
  cancelledUids: string[];
  skipped: number;
}

/** Parse the bounded VEVENT/VTODO subset used by deadline feeds. */
export function parseIcalFeed(content: string, fallbackTimezone: string): ParsedIcalFeed {
  if (!content.includes('BEGIN:VCALENDAR')) throw new Error('The source did not return an iCalendar document.');
  const lines = content.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events: Record<string, IcalEvent> = {};
  const cancelledUids: string[] = [];
  let skipped = 0;
  let component: 'VEVENT' | 'VTODO' | undefined;
  let properties = new Map<string, { value: string; params: Record<string, string> }[]>();

  const finish = () => {
    if (!component) return;
    try {
      const one = (key: string) => properties.get(key)?.at(-1);
      const uid = unescapeText(one('UID')?.value ?? '').trim();
      const title = unescapeText(one('SUMMARY')?.value ?? '').trim();
      const status = (one('STATUS')?.value ?? '').toUpperCase();
      if (!uid || !title || properties.has('RRULE') || properties.has('RECURRENCE-ID')) {
        skipped += 1;
        return;
      }
      if (status === 'CANCELLED') {
        cancelledUids.push(uid);
        return;
      }

      const startProperty = component === 'VTODO' ? one('DUE') ?? one('DTSTART') : one('DTSTART');
      if (!startProperty) { skipped += 1; return; }
      const start = parseDate(startProperty.value, startProperty.params.TZID ?? fallbackTimezone);
      if (!start) { skipped += 1; return; }
      const endProperty = component === 'VTODO' ? undefined : one('DTEND');
      const durationProperty = one('DURATION');
      if (endProperty && durationProperty) { skipped += 1; return; }
      let end: string;
      if (component === 'VTODO') {
        end = start.isDateOnly
          ? addCalendarDay(start.value)
          : new Date(Date.parse(start.value) + 60_000).toISOString();
      } else if (endProperty) {
        const parsedEnd = parseDate(endProperty.value, endProperty.params.TZID ?? fallbackTimezone);
        if (!parsedEnd || parsedEnd.isDateOnly !== start.isDateOnly) { skipped += 1; return; }
        end = parsedEnd.value;
      } else if (durationProperty) {
        const duration = parseDuration(durationProperty.value);
        if (!duration) { skipped += 1; return; }
        end = start.isDateOnly && duration.milliseconds === 0
          ? addCalendarDay(start.value, duration.calendarDays)
          : new Date(Date.parse(start.value) + duration.milliseconds + duration.calendarDays * 24 * 60 * 60_000).toISOString();
      } else if (start.isDateOnly) {
        end = addCalendarDay(start.value);
      } else {
        end = new Date(Date.parse(start.value) + 60_000).toISOString();
      }
      if (Date.parse(end) <= Date.parse(start.value)) { skipped += 1; return; }
      const versionFields = [uid, one('SEQUENCE')?.value ?? '0', one('LAST-MODIFIED')?.value ?? '',
        title, start.value, end, status];
      const version = createHash('sha256').update(versionFields.join('\0')).digest('hex');
      events[uid] = { uid, title, startIso: start.value, endIso: end, version };
    } catch {
      skipped += 1;
    } finally {
      component = undefined;
      properties = new Map();
    }
  };

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT' || line === 'BEGIN:VTODO') {
      finish();
      component = line === 'BEGIN:VEVENT' ? 'VEVENT' : 'VTODO';
      properties = new Map();
      continue;
    }
    if (line === 'END:VEVENT' || line === 'END:VTODO') {
      finish();
      continue;
    }
    if (!component) continue;
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const [namePart, value] = [line.slice(0, separator), line.slice(separator + 1)];
    const [name, ...parameterParts] = namePart.split(';');
    const params: Record<string, string> = {};
    for (const part of parameterParts) {
      const index = part.indexOf('=');
      if (index > 0) params[part.slice(0, index).toUpperCase()] = part.slice(index + 1).replace(/^"|"$/g, '');
    }
    const key = name?.toUpperCase();
    if (!key) continue;
    const values = properties.get(key) ?? [];
    values.push({ value, params });
    properties.set(key, values);
  }
  finish();
  return { events, cancelledUids: [...new Set(cancelledUids)], skipped };
}

function parseDate(raw: string, timezone: string): { value: string; isDateOnly: boolean } | undefined {
  if (/^\d{8}$/.test(raw)) {
    const isoDate = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    if (!isValidDate(isoDate)) return undefined;
    return { value: isoDate, isDateOnly: true };
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(raw);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second = '00', zulu] = match;
  const local = `${year}-${month}-${day}T${hour}:${minute}`;
  if (!isValidDate(`${year}-${month}-${day}`) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return undefined;
  if (zulu) {
    const instant = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    return { value: new Date(instant).toISOString(), isDateOnly: false };
  }
  return { value: localDateTimeToIso(local, timezone), isDateOnly: false };
}

function unescapeText(value: string): string {
  return value.replace(/\\[nN]/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function isValidDate(value: string): boolean {
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function addCalendarDay(value: string, days = 1): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * 24 * 60 * 60_000).toISOString().slice(0, 10);
}

function parseDuration(value: string): { calendarDays: number; milliseconds: number } | undefined {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match) return undefined;
  const weeks = Number(match[1] ?? 0);
  const days = Number(match[2] ?? 0);
  const hours = Number(match[3] ?? 0);
  const minutes = Number(match[4] ?? 0);
  const seconds = Number(match[5] ?? 0);
  const calendarDays = weeks * 7 + days;
  const milliseconds = ((hours * 60 + minutes) * 60 + seconds) * 1000;
  return calendarDays || milliseconds ? { calendarDays, milliseconds } : undefined;
}

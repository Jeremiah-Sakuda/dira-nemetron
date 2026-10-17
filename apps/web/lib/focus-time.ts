/** A recurring wall-clock choice, not an instant to convert to the browser timezone. */
export function formatFocusTime(minute: number): string {
  if (minute === 1440) return '12:00 AM (next day)';
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2020, 0, 1, Math.floor(minute / 60), minute % 60)));
}

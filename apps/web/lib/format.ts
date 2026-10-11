export function label(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (part) => part.toUpperCase());
}

export function formatSlack(minutes: number | undefined | null): string {
  if (minutes === undefined || minutes === null) return '—';
  const absolute = Math.abs(Math.round(minutes));
  const hours = absolute / 60;
  return `${minutes < 0 ? '−' : '+'}${hours >= 10 ? hours.toFixed(0) : hours.toFixed(1)}h`;
}

export function formatWhen(iso: string | null | undefined, timezone?: string): string {
  if (!iso) return 'unscheduled';
  return new Intl.DateTimeFormat('en', {
    weekday: 'short', hour: 'numeric', minute: '2-digit', ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(iso));
}

export function formatDay(iso: string, timezone?: string): string {
  return new Intl.DateTimeFormat('en', { weekday: 'long', month: 'short', day: 'numeric', ...(timezone ? { timeZone: timezone } : {}) })
    .format(new Date(iso));
}

export async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  try {
    return await response.json() as T & { error?: string };
  } catch {
    return { error: `Request failed (HTTP ${response.status})` } as T & { error?: string };
  }
}

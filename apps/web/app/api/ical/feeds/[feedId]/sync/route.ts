export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ feedId: string }> }): Promise<Response> {
  const base = process.env.DIRA_CLOUD_RUN_URL?.replace(/\/$/, '');
  if (!base) return Response.json({ error: 'iCalendar service is not configured' }, { status: 503 });
  const { feedId } = await context.params;
  try {
    const upstream = await fetch(`${base}/api/ical/feeds/${encodeURIComponent(feedId)}/sync`, {
      method: 'POST',
      headers: {
        cookie: request.headers.get('cookie') ?? '',
        ...(request.headers.get('origin') ? { origin: request.headers.get('origin')! } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(240_000),
    });
    return Response.json(await upstream.json(), { status: upstream.status, headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'iCalendar sync service is unavailable' }, { status: 503 });
  }
}

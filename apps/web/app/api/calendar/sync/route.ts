export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const base = process.env.DIRA_CLOUD_RUN_URL?.replace(/\/$/, '');
  if (!base) return Response.json({ error: 'Calendar service is not configured' }, { status: 503 });
  try {
    const upstream = await fetch(`${base}/api/calendar/sync`, {
      method: 'POST',
      headers: {
        cookie: request.headers.get('cookie') ?? '',
        ...(request.headers.get('origin') ? { origin: request.headers.get('origin')! } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(120_000),
    });
    return Response.json(await upstream.json(), {
      status: upstream.status,
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch {
    return Response.json({ error: 'Calendar sync service is unavailable' }, { status: 503 });
  }
}

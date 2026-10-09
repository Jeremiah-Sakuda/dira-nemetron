export const dynamic = 'force-dynamic';

async function forward(request: Request, method: 'GET' | 'POST'): Promise<Response> {
  const base = process.env.DIRA_CLOUD_RUN_URL?.replace(/\/$/, '');
  if (!base) return Response.json({ error: 'iCalendar service is not configured' }, { status: 503 });
  try {
    const upstream = await fetch(`${base}/api/ical/feeds`, {
      method,
      headers: {
        cookie: request.headers.get('cookie') ?? '',
        ...(request.headers.get('origin') ? { origin: request.headers.get('origin')! } : {}),
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: await request.text() } : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    return Response.json(await upstream.json(), { status: upstream.status, headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'iCalendar service is unavailable' }, { status: 503 });
  }
}

export const GET = (request: Request) => forward(request, 'GET');
export const POST = (request: Request) => forward(request, 'POST');

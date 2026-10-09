export const dynamic = 'force-dynamic';

async function forward(request: Request, feedId: string, method: 'PATCH' | 'DELETE'): Promise<Response> {
  const base = process.env.DIRA_CLOUD_RUN_URL?.replace(/\/$/, '');
  if (!base) return Response.json({ error: 'iCalendar service is not configured' }, { status: 503 });
  try {
    const upstream = await fetch(`${base}/api/ical/feeds/${encodeURIComponent(feedId)}`, {
      method,
      headers: {
        cookie: request.headers.get('cookie') ?? '',
        ...(request.headers.get('origin') ? { origin: request.headers.get('origin')! } : {}),
        ...(method === 'PATCH' ? { 'content-type': 'application/json' } : {}),
      },
      ...(method === 'PATCH' ? { body: await request.text() } : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    return Response.json(await upstream.json(), { status: upstream.status, headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'iCalendar service is unavailable' }, { status: 503 });
  }
}

type Context = { params: Promise<{ feedId: string }> };
export async function PATCH(request: Request, context: Context): Promise<Response> {
  return forward(request, (await context.params).feedId, 'PATCH');
}
export async function DELETE(request: Request, context: Context): Promise<Response> {
  return forward(request, (await context.params).feedId, 'DELETE');
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const base = process.env.DIRA_CLOUD_RUN_URL?.replace(/\/$/, '');
  if (!base) return Response.json({ error: 'Calendar service is not configured' }, { status: 503 });
  const upstream = await fetch(`${base}/api/calendar/events`, {
    headers: { cookie: request.headers.get('cookie') ?? '' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  return Response.json(await upstream.json(), { status: upstream.status, headers: { 'cache-control': 'private, no-store' } });
}

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const base = process.env.DIRA_CLOUD_RUN_URL?.replace(/\/$/, '');
  if (!base) return Response.json({ error: 'Graph service is not configured' }, { status: 503 });
  const upstream = await fetch(`${base}/api/graph/proposals/review`, {
    method: 'POST',
    headers: {
      cookie: request.headers.get('cookie') ?? '',
      ...(request.headers.get('origin') ? { origin: request.headers.get('origin')! } : {}),
      'content-type': 'application/json',
    },
    body: await request.text(),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  return Response.json(await upstream.json(), {
    status: upstream.status,
    headers: { 'cache-control': 'private, no-store' },
  });
}

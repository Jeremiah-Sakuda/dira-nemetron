export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const base = process.env.DIRA_CLOUD_RUN_URL?.replace(/\/$/, '');
  if (!base) return Response.json({ error: 'Account service is not configured' }, { status: 503 });
  const upstream = await fetch(`${base}/api/memory/import`, {
    method: 'POST',
    headers: {
      cookie: request.headers.get('cookie') ?? '',
      origin: request.headers.get('origin') ?? '',
      'content-type': request.headers.get('content-type') ?? 'application/octet-stream',
    },
    body: request.body,
    cache: 'no-store',
    duplex: 'half',
    signal: AbortSignal.timeout(60_000),
  } as RequestInit & { duplex: 'half' });
  return Response.json(await upstream.json(), {
    status: upstream.status,
    headers: { 'cache-control': 'private, no-store' },
  });
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return proxy(request, 'GET');
}

export async function POST(request: Request): Promise<Response> {
  return proxy(request, 'POST', await request.text());
}

async function proxy(request: Request, method: 'GET' | 'POST', body?: string): Promise<Response> {
  const base = process.env.DIRA_CLOUD_RUN_URL?.replace(/\/$/, '');
  if (!base) return Response.json({ error: 'Graph service is not configured' }, { status: 503 });
  const upstream = await fetch(`${base}/api/graph/proposals`, {
    method,
    headers: {
      cookie: request.headers.get('cookie') ?? '',
      ...(request.headers.get('origin') ? { origin: request.headers.get('origin')! } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(120_000),
  });
  return Response.json(await upstream.json(), {
    status: upstream.status,
    headers: { 'cache-control': 'private, no-store' },
  });
}

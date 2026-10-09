export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const base = process.env.DIRA_CLOUD_RUN_URL?.replace(/\/$/, '');
  if (!base) return Response.json({ error: 'Account service is not configured' }, { status: 503 });
  const upstream = await fetch(`${base}/api/me`, {
    headers: { cookie: request.headers.get('cookie') ?? '' },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  return Response.json(await upstream.json(), { status: upstream.status, headers: { 'cache-control': 'private, no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  const base = process.env.DIRA_CLOUD_RUN_URL?.replace(/\/$/, '');
  if (!base) return Response.json({ error: 'Account service is not configured' }, { status: 503 });
  const upstream = await fetch(`${base}/auth/logout`, {
    method: 'POST',
    headers: {
      cookie: request.headers.get('cookie') ?? '',
      origin: new URL(request.url).origin,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  const response = Response.json(await upstream.json(), { status: upstream.status, headers: { 'cache-control': 'private, no-store' } });
  if (upstream.ok) response.headers.append('set-cookie', clearSessionCookie());
  return response;
}

function clearSessionCookie(): string {
  return `dira_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

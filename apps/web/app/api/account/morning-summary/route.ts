export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const base = process.env.DIRA_CLOUD_RUN_URL?.replace(/\/$/, '');
  if (!base) return Response.json({ error: 'Account service is not configured' }, { status: 503 });
  try {
    const upstream = await fetch(`${base}/api/account/morning-summary`, {
      headers: { cookie: request.headers.get('cookie') ?? '' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    return Response.json(await upstream.json(), { status: upstream.status, headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'Morning summary service is unavailable' }, { status: 503 });
  }
}

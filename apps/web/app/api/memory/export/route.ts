export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const base = process.env.DIRA_CLOUD_RUN_URL?.replace(/\/$/, '');
  if (!base) return Response.json({ error: 'Account service is not configured' }, { status: 503 });
  const upstream = await fetch(`${base}/api/memory/export`, {
    headers: { cookie: request.headers.get('cookie') ?? '' },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      ...(upstream.headers.get('content-disposition')
        ? { 'content-disposition': upstream.headers.get('content-disposition')! }
        : {}),
      'cache-control': 'private, no-store',
    },
  });
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const base = process.env.DIRA_CLOUD_RUN_URL?.replace(/\/$/, '');
  if (!base) return Response.json({ error: 'Google account service is not configured' }, { status: 503 });

  try {
    const upstream = await fetch(`${base}/auth/google/calendar-write/start`, {
      headers: { cookie: request.headers.get('cookie') ?? '' },
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const location = upstream.headers.get('location');
    const cookie = upstream.headers.get('set-cookie');
    if (upstream.status !== 302 || !location || !cookie) {
      return Response.json(
        { error: upstream.status === 401 ? 'Sign in before enabling Calendar changes.' : 'Calendar permission could not be started.' },
        { status: upstream.status === 401 ? 401 : 502 },
      );
    }
    const response = Response.redirect(location, 302);
    response.headers.append('set-cookie', cookie.replace('Path=/auth/google', 'Path=/api/auth/google'));
    response.headers.set('cache-control', 'private, no-store');
    return response;
  } catch {
    return Response.json({ error: 'Sign-in service is unavailable' }, { status: 503 });
  }
}

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const base = process.env.DIRA_CLOUD_RUN_URL?.replace(/\/$/, '');
  if (!base) return Response.json({ error: 'Google sign-in is not configured' }, { status: 503 });

  try {
    const upstream = await fetch(`${base}/auth/google/start`, {
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const location = upstream.headers.get('location');
    const cookie = upstream.headers.get('set-cookie');
    if (upstream.status !== 302 || !location || !cookie) {
      return Response.json({ error: 'Google sign-in could not be started' }, { status: 502 });
    }
    const response = Response.redirect(location, 302);
    response.headers.append('set-cookie', cookie.replace('Path=/auth/google', 'Path=/api/auth/google'));
    response.headers.set('cache-control', 'private, no-store');
    return response;
  } catch {
    return Response.json({ error: 'Sign-in service is unavailable' }, { status: 503 });
  }
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const base = process.env.DIRA_CLOUD_RUN_URL?.replace(/\/$/, '');
  const incoming = new URL(request.url);
  const code = incoming.searchParams.get('code');
  const state = incoming.searchParams.get('state');
  const googleError = incoming.searchParams.get('error');
  const origin = appOrigin(incoming.origin);
  if (googleError || !code || !state) {
    const response = Response.redirect(new URL('/onboarding?auth_error=google', origin), 302);
    response.headers.append('set-cookie', clearStateCookie());
    return response;
  }
  if (!base) return Response.redirect(new URL('/onboarding?auth_error=unavailable', origin), 302);

  try {
    const upstream = await fetch(`${base}/auth/google/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: request.headers.get('cookie') ?? '',
      },
      body: JSON.stringify({ code, state }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) throw new Error('Google sign-in did not complete');
    const result = await upstream.json() as { sessionCookie: string; clearStateCookie: string };
    if (!result.sessionCookie || !result.clearStateCookie) throw new Error('Invalid sign-in response');
    const response = Response.redirect(new URL('/onboarding?signed_in=1', origin), 302);
    response.headers.append('set-cookie', result.sessionCookie);
    response.headers.append('set-cookie', result.clearStateCookie.replace('Path=/auth/google', 'Path=/api/auth/google'));
    response.headers.set('cache-control', 'private, no-store');
    return response;
  } catch {
    const response = Response.redirect(new URL('/onboarding?auth_error=unavailable', origin), 302);
    response.headers.append('set-cookie', clearStateCookie());
    return response;
  }
}

function appOrigin(requestOrigin: string): string {
  const configured = process.env.DIRA_WEB_ORIGIN;
  if (configured) return new URL(configured).origin;
  if (process.env.NODE_ENV === 'production') throw new Error('DIRA_WEB_ORIGIN is required for the OAuth callback');
  return requestOrigin;
}

function clearStateCookie(): string {
  return `dira_oauth_state=; Path=/api/auth/google; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

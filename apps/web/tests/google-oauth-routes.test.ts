import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as start } from '../app/api/auth/google/start/route.js';
import { GET as calendarWrite } from '../app/api/auth/google/calendar-write/route.js';
import { GET as gmailRead } from '../app/api/auth/google/gmail-read/route.js';
import { GET as gmailCompose } from '../app/api/auth/google/gmail-compose/route.js';

const startRoutes = { start, 'calendar-write': calendarWrite, 'gmail-read': gmailRead, 'gmail-compose': gmailCompose };

beforeEach(() => {
  vi.stubEnv('DIRA_ORCHESTRATOR_URL', 'https://backend.example');
  vi.stubEnv('DIRA_WEB_ORIGIN', 'https://dira.example');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Google OAuth redirects', () => {
  it.each(['start', 'calendar-write', 'gmail-read', 'gmail-compose'] as const)(
    '%s forwards the redirect and a correctly scoped state cookie', async (route) => {
      const fetcher = vi.fn().mockResolvedValue(new Response(null, {
        status: 302,
        headers: {
          location: 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic',
          'set-cookie': 'dira_oauth_state=synthetic; Path=/auth/google; HttpOnly; SameSite=Lax; Secure',
        },
      }));
      vi.stubGlobal('fetch', fetcher);
      const response = await startRoutes[route](new Request(`https://dira.example/api/auth/google/${route}`, {
        headers: { cookie: 'dira_session=synthetic' },
      }));
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toContain('https://accounts.google.com/');
      expect(response.headers.get('set-cookie')).toContain('Path=/api/auth/google; HttpOnly');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      if (route !== 'start') expect(fetcher.mock.calls[0]![1].headers.cookie).toBe('dira_session=synthetic');
    },
  );

  it('completes sign-in with separate session and state-clearing cookies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      sessionCookie: 'dira_session=synthetic; Path=/; HttpOnly; Secure',
      clearStateCookie: 'dira_oauth_state=; Path=/auth/google; Max-Age=0; HttpOnly; Secure',
    })));
    const { GET } = await import('../app/api/auth/google/callback/route.js');
    const response = await GET(new Request('https://dira.example/api/auth/google/callback?code=synthetic&state=synthetic'));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://dira.example/onboarding?signed_in=1');
    expect(response.headers.getSetCookie()).toEqual([
      'dira_session=synthetic; Path=/; HttpOnly; Secure',
      'dira_oauth_state=; Path=/api/auth/google; Max-Age=0; HttpOnly; Secure',
    ]);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it.each(['?error=access_denied', ''])('clears state when consent is cancelled or invalid: %s', async (query) => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { GET } = await import('../app/api/auth/google/callback/route.js');
    const response = await GET(new Request(`https://dira.example/api/auth/google/callback${query}`));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://dira.example/onboarding?auth_error=google');
    expect(response.headers.get('set-cookie')).toContain('Path=/api/auth/google; Max-Age=0');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('clears state when the backend cannot complete sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'invalid_state' }, { status: 400 })));
    const { GET } = await import('../app/api/auth/google/callback/route.js');
    const response = await GET(new Request('https://dira.example/api/auth/google/callback?code=synthetic&state=synthetic'));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://dira.example/onboarding?auth_error=unavailable');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

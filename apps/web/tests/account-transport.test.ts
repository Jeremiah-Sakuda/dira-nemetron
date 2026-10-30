import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as session } from '../app/api/me/route.js';
import { POST as approve } from '../app/api/approvals/route.js';
import { GET as edges } from '../app/api/graph/edges/route.js';
import { PATCH as editFeed, DELETE as deleteFeed } from '../app/api/ical/feeds/[feedId]/route.js';
import { POST as syncFeed, maxDuration } from '../app/api/ical/feeds/[feedId]/sync/route.js';

beforeEach(() => vi.stubEnv('DIRA_ORCHESTRATOR_URL', 'https://backend.example/'));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('account routes through the shared transport interface', () => {
  it.each([401, 403, 409])('preserves upstream JSON and status %s with private caching', async status => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: 'synthetic denial' }, { status }));
    vi.stubGlobal('fetch', fetcher);
    const response = await session(new Request('https://dira.example/api/me', { headers: { cookie: 'dira_session=synthetic' } }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'synthetic denial' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(fetcher.mock.calls[0]![0]).toBe('https://backend.example/api/me');
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'manual', headers: { cookie: 'dira_session=synthetic' } });
  });

  it('forwards a mutation body and original Origin without inventing authorization', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }, { headers: { 'set-cookie': 'dira_session=renewed; HttpOnly' } }));
    vi.stubGlobal('fetch', fetcher);
    const response = await approve(new Request('https://dira.example/api/approvals', {
      method: 'POST', headers: { cookie: 'dira_session=synthetic', origin: 'https://original.example' }, body: '{"decision":"APPROVED"}',
    }));
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'POST', body: '{"decision":"APPROVED"}', headers: { origin: 'https://original.example', 'content-type': 'application/json' } });
    expect(response.headers.get('set-cookie')).toContain('dira_session=renewed');
  });

  it('keeps dynamic feed IDs encoded for PATCH and DELETE', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    const context = { params: Promise.resolve({ feedId: 'synthetic/id?x=1' }) };
    const patched = await editFeed(new Request('https://dira.example/api/ical/feeds/test', { method: 'PATCH', body: '{}' }), context);
    const deleted = await deleteFeed(new Request('https://dira.example/api/ical/feeds/test', { method: 'DELETE' }), context);
    expect(fetcher.mock.calls.map(c => c[0])).toEqual(Array(2).fill('https://backend.example/api/ical/feeds/synthetic%2Fid%3Fx%3D1'));
    expect(fetcher.mock.calls.map(c => c[1].method)).toEqual(['PATCH', 'DELETE']);
    expect(fetcher.mock.calls[1]![1].headers).not.toHaveProperty('origin');
    expect(patched.status).toBe(204); expect(await patched.text()).toBe(''); expect(deleted.status).toBe(204);
  });

  it('preserves explicit long-running timeouts and feed route duration', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ ok: true })));
    try {
      await edges(new Request('https://dira.example/api/graph/edges'));
      await syncFeed(new Request('https://dira.example/api/ical/feeds/test/sync', { method: 'POST' }), { params: Promise.resolve({ feedId: 'test' }) });
      expect(timeout.mock.calls.map(c => c[0])).toEqual([120_000, 240_000]); expect(maxDuration).toBe(300);
    } finally { timeout.mockRestore(); }
  });

  it.each(['network', 'invalid-json', 'redirect', 'body-read'])('returns a private recoverable response for %s failure', async mode => {
    const fetcher = vi.fn().mockImplementation(async () => {
      if (mode === 'network') throw new Error('private upstream detail');
      if (mode === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://untrusted.example' } });
      return new Response('<html>private upstream detail</html>');
    });
    vi.stubGlobal('fetch', fetcher);
    const request = new Request('https://dira.example/api/approvals', { method: 'POST', body: '{}' });
    if (mode === 'body-read') vi.spyOn(request, 'text').mockRejectedValue(new Error('aborted body'));
    const response = await approve(request);
    expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).not.toContain('private upstream detail');
    if (mode === 'body-read') expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails privately when no backend is configured', async () => {
    vi.stubEnv('DIRA_ORCHESTRATOR_URL', ''); vi.stubEnv('DIRA_CLOUD_RUN_URL', '');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const response = await session(new Request('https://dira.example/api/me'));
    expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(fetcher).not.toHaveBeenCalled();
  });
});

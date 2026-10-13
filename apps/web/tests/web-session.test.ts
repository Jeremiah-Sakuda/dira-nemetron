import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('shared web session refresh', () => {
  it('broadcasts the newly created demo to existing navigation subscribers', async () => {
    const window = new EventTarget(); vi.stubGlobal('window', window);
    const received: unknown[] = [];
    window.addEventListener('dira-session-changed', event => received.push((event as CustomEvent).detail));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ account: { accountId: 'demo-test', kind: 'demo', timezone: 'UTC' }, permissions: {} })));
    vi.stubGlobal('fetch', fetcher);
    const { loadSession, startDemo } = await import('../lib/use-session.js');
    expect((await loadSession()).status).toBe('signed-out');
    await startDemo();
    expect(received.at(-1)).toMatchObject({ status: 'signed-in', kind: 'demo', accountId: 'demo-test' });
    expect(fetcher.mock.calls[1]![0]).toBe('/api/auth/demo');
  });

  it('does not broadcast a slow stale response over the refreshed session', async () => {
    const window = new EventTarget(); vi.stubGlobal('window', window);
    const received: unknown[] = [];
    window.addEventListener('dira-session-changed', event => received.push((event as CustomEvent).detail));
    let finishOld!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ account: { accountId: 'demo-new', kind: 'demo' }, permissions: {} }))));
    const { loadSession } = await import('../lib/use-session.js');
    const old = loadSession();
    await loadSession(true);
    finishOld(new Response('{}', { status: 401 })); await old;
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ accountId: 'demo-new' });
  });
});

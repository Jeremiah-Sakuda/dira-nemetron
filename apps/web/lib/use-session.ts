'use client';

import { useEffect, useState } from 'react';

export interface SessionInfo {
  status: 'loading' | 'signed-out' | 'signed-in' | 'unavailable';
  accountId?: string;
  email?: string;
  kind?: 'google' | 'demo';
  timezone?: string;
  permissions?: { calendarWrite: boolean; gmailRead: boolean; gmailCompose?: boolean };
}

let cached: Promise<SessionInfo> | undefined;

export function loadSession(force = false): Promise<SessionInfo> {
  if (!cached || force) {
    cached = fetch('/api/me', { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 401) return { status: 'signed-out' } as SessionInfo;
        if (!response.ok) return { status: 'unavailable' } as SessionInfo;
        const body = await response.json() as {
          account: { accountId: string; email: string; timezone: string; kind?: 'google' | 'demo' };
          permissions: SessionInfo['permissions'];
        };
        return {
          status: 'signed-in', accountId: body.account.accountId, email: body.account.email,
          kind: body.account.kind ?? 'google', timezone: body.account.timezone, permissions: body.permissions,
        } as SessionInfo;
      })
      .catch(() => ({ status: 'unavailable' }) as SessionInfo);
  }
  return cached;
}

export function useSession(): SessionInfo {
  const [session, setSession] = useState<SessionInfo>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    void loadSession().then((value) => { if (active) setSession(value); });
    return () => { active = false; };
  }, []);
  return session;
}

/** Start a fresh synthetic demo session and return once the cookie is set. */
export async function startDemo(): Promise<void> {
  const response = await fetch('/api/auth/demo', { method: 'POST' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'The demo could not be started.');
  }
  await loadSession(true);
}

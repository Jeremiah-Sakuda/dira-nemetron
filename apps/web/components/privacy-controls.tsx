'use client';

import { useEffect, useState } from 'react';
import { readJson } from '../lib/format';
import { loadSession, useSession } from '../lib/use-session';
import { MessagingSettings } from './messaging-settings';

interface EgressRow { host: string; verdict: string; statusCode: number; purpose: string; createdAtIso: string }

/** Network boundary audit, export, and account deletion. */
export function PrivacyControls() {
  const session = useSession();
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [audit, setAudit] = useState<EgressRow[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (session.status !== 'signed-in') return;
    void (async () => {
      const response = await fetch('/api/egress', { cache: 'no-store' });
      const body = await readJson<{ allowlist: string[]; audit: EgressRow[] }>(response);
      if (response.ok) { setAllowlist(body.allowlist); setAudit(body.audit); }
    })();
  }, [session.status]);

  async function deleteAccount() {
    const response = await fetch('/api/account', { method: 'DELETE' });
    if (!response.ok) { setMessage((await readJson(response)).error ?? 'Deletion failed.'); return; }
    await loadSession(true);
    window.location.href = '/';
  }

  if (session.status !== 'signed-in') return null;
  return (
    <>
      <MessagingSettings />
      <section className="panel policy-settings" aria-labelledby="network-title">
        <div className="section-label">Privacy boundary</div>
        <h2 id="network-title">Where Dira may connect</h2>
        <p className="muted">Dira&rsquo;s runtime can only reach these hosts. Anything else is refused with HTTP 403 and recorded below. In deployment the OpenShell sandbox enforces the same list at the network boundary.</p>
        <p className="mono allowlist">{allowlist.join(' · ')}</p>
        {audit.length === 0 ? <p className="muted">No blocked connection attempts.</p> : (
          <ol className="egress-audit">{audit.slice(0, 10).map((row) => (
            <li key={row.createdAtIso}><time dateTime={row.createdAtIso}>{new Date(row.createdAtIso).toLocaleString()}</time> {row.verdict} {row.host} → {row.statusCode} · {row.purpose}</li>
          ))}</ol>
        )}
      </section>
      <section className="panel policy-settings" aria-labelledby="data-title">
        <div className="section-label">Your data</div>
        <h2 id="data-title">Export or delete</h2>
        <p className="muted">Your graph, policy, rules and Skills live in a private Git repository. Download it any time. Deleting your account removes the repository, stored tokens, every run record and your database partition.</p>
        <div className="proposal-actions">
          {session.kind !== 'demo' && <a className="btn btn-secondary" href="/api/memory/export">Export memory (Git bundle)</a>}
          {!confirming ? (
            <button className="btn btn-secondary" type="button" onClick={() => setConfirming(true)}>{session.kind === 'demo' ? 'End demo and delete its data' : 'Delete my account'}</button>
          ) : (
            <button className="btn danger" type="button" onClick={() => void deleteAccount()}>Yes, delete everything</button>
          )}
        </div>
        {message && <p className="form-error" role="alert">{message}</p>}
      </section>
    </>
  );
}

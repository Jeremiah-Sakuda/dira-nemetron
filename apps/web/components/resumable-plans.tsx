'use client';

import { useEffect, useState } from 'react';
import { readJson } from '../lib/format';

interface ResumableWorkflow { workflowId: string; label: string }

/** Calendar schedule plans whose approvals are complete but that stopped before execution (Google accounts). */
export function ResumablePlans() {
  const [items, setItems] = useState<ResumableWorkflow[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const response = await fetch('/api/approvals', { cache: 'no-store' });
    const body = await readJson<{ resumableWorkflows?: ResumableWorkflow[] }>(response);
    if (response.ok) setItems(body.resumableWorkflows ?? []);
  }
  useEffect(() => { void load(); }, []);

  async function resume(item: ResumableWorkflow) {
    setBusy(item.workflowId); setMessage('');
    const response = await fetch('/api/approvals/resume', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workflowId: item.workflowId }),
    });
    const body = await readJson<{ status?: string; reason?: string; verifiedActions?: number }>(response);
    setMessage(!response.ok ? body.error ?? 'The plan could not resume.'
      : body.status === 'RESOLVED' ? `Plan completed; ${body.verifiedActions ?? 0} action(s) verified against Google Calendar.` : body.reason ?? 'Waiting for review.');
    setBusy('');
    await load();
  }

  if (!items.length && !message) return null;
  return (
    <section className="panel" aria-labelledby="resumable-title">
      <h2 id="resumable-title">Plans waiting to resume</h2>
      {message && <p className="graph-notice" role="status">{message}</p>}
      {items.map((item) => (
        <div className="recent-decision" key={item.workflowId}>
          <strong>{item.label}</strong>
          <button className="btn" type="button" disabled={busy === item.workflowId} onClick={() => void resume(item)}>
            {busy === item.workflowId ? 'Resuming…' : 'Resume plan'}
          </button>
        </div>
      ))}
    </section>
  );
}

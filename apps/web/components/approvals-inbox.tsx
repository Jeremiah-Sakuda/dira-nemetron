'use client';

import { useEffect, useState } from 'react';

interface PendingApproval {
  actionId: string;
  workflowId: string;
  type: string;
  target: string;
  summary: string;
  externalSystem?: string;
  policyRule: string;
  requestedAtIso?: string;
}

interface RecentDecision {
  actionId: string;
  decision: 'APPROVED' | 'REJECTED';
  decidedAtIso: string;
  summary: string;
  status: string | null;
}

export function ApprovalsInbox() {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [recentDecisions, setRecentDecisions] = useState<RecentDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/approvals', { cache: 'no-store' });
      const result = await response.json() as { approvals?: PendingApproval[]; recentDecisions?: RecentDecision[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Approvals could not be loaded.');
      setApprovals(result.approvals ?? []);
      setRecentDecisions(result.recentDecisions ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Approvals could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  async function decide(item: PendingApproval, decision: 'APPROVED' | 'REJECTED') {
    setBusyId(item.actionId);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actionId: item.actionId, decision }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Decision could not be recorded.');
      setApprovals((current) => current.filter((approval) => approval.actionId !== item.actionId));
      setNotice(decision === 'APPROVED'
        ? 'Authorization recorded. This account path does not execute actions yet.'
        : 'Action rejected and recorded.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Decision could not be recorded.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <main>
      <h1 className="page-title">Approvals</h1>
      <p className="page-sub">Review actions the account policy has held for your decision. A web decision is attributed to your signed-in Google account.</p>
      <section className="panel approvals-panel" aria-live="polite">
        <div className="approvals-heading">
          <div>
            <div className="section-label">Your account</div>
            <h2>Action inbox</h2>
          </div>
          <button className="btn btn-secondary" type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        <p className="privacy-note">Approving records authorization only. Before execution is connected, the workflow must re-read external state and re-run feasibility and policy. This build does not execute account actions.</p>
        {loading && <p className="muted" role="status">Loading approvals…</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="graph-notice" role="status">{notice}</p>}
        {!loading && !error && approvals.length === 0 && <p className="muted approvals-empty">No actions are waiting for approval.</p>}
        <div className="proposal-list">
          {approvals.map((item) => (
            <article className="proposal-card approval-card" key={item.actionId}>
              <div className="section-label">{label(item.type)}{item.externalSystem ? ` · ${label(item.externalSystem)}` : ''}</div>
              <h3>{item.summary}</h3>
              <dl className="approval-details">
                <div><dt>Policy</dt><dd>{label(item.policyRule)}</dd></div>
                <div><dt>Target</dt><dd>{item.target}</dd></div>
                {item.requestedAtIso && <div><dt>Requested</dt><dd><time dateTime={item.requestedAtIso}>{new Date(item.requestedAtIso).toLocaleString()}</time></dd></div>}
              </dl>
              <div className="proposal-actions">
                <button className="btn" type="button" disabled={busyId === item.actionId} onClick={() => void decide(item, 'APPROVED')}>{busyId === item.actionId ? 'Recording…' : 'Authorize action'}</button>
                <button className="btn btn-secondary" type="button" disabled={busyId === item.actionId} onClick={() => void decide(item, 'REJECTED')}>Reject</button>
              </div>
            </article>
          ))}
        </div>
        {recentDecisions.length > 0 && <section className="recent-decisions" aria-labelledby="recent-approvals-title">
          <h3 id="recent-approvals-title">Recent decisions</h3>
          {recentDecisions.map((item) => <div className="recent-decision" key={`${item.actionId}-${item.decidedAtIso}`}>
            <div><strong>{item.summary}</strong><span className="muted"> · {label(item.decision)}{item.status ? ` · ${label(item.status)}` : ''}</span></div>
            <time dateTime={item.decidedAtIso}>{new Date(item.decidedAtIso).toLocaleString()}</time>
          </div>)}
        </section>}
      </section>
    </main>
  );
}

function label(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (part) => part.toUpperCase());
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MorningSummary } from './morning-summary';
import { RelayedNotes } from './relayed-notes';
import { formatSlack, label, readJson } from '../lib/format';
import { useSession } from '../lib/use-session';

interface WorkflowSummary { id: string; status: string; mutationSummary?: string; slackFinalMin?: number; slackAfterMutationMin?: number }

export function TodayView() {
  const session = useSession();
  const [pending, setPending] = useState<number | null>(null);
  const [runs, setRuns] = useState<WorkflowSummary[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (session.status !== 'signed-in') return;
    let cancelled = false;
    setLoaded(false); setError(''); setPending(null);
    void (async () => {
      const [approvals, workflows] = await Promise.all([fetch('/api/approvals', { cache: 'no-store' }), fetch('/api/workflows', { cache: 'no-store' })]);
      const approvalBody = await readJson<{ approvals?: unknown[] }>(approvals);
      const workflowBody = await readJson<{ workflows?: WorkflowSummary[] }>(workflows);
      if (!approvals.ok || !workflows.ok) throw new Error('Could not load current approvals and repair history. Status is unknown; retry before assuming nothing needs attention.');
      if (cancelled) return;
      setPending(approvalBody.approvals?.length ?? 0);
      setRuns((workflowBody.workflows ?? []).slice(0, 5)); setLoaded(true);
    })().catch(cause => {if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load Today.');});
    return () => {cancelled = true;};
  }, [session.status, retry]);

  if (session.status === 'loading') return <main><p className="muted" role="status">Loading…</p></main>;
  if (session.status !== 'signed-in') {
    return (
      <main>
        <h1 className="page-title">Today</h1>
        <section className="panel"><p>Sign in with Google or <Link href="/">start the demo</Link> to see your day.</p></section>
      </main>
    );
  }
  return (
    <main className="today">
      <h1 className="page-title">Today</h1>
      <p className="page-sub">{session.kind === 'demo' ? 'Demo session. ' : ''}What Dira is watching, what it did, and what is waiting for you.</p>
      {error && <section className="panel"><p className="form-error" role="alert">{error}</p><button className="btn" onClick={() => setRetry(value => value + 1)}>Retry Today</button></section>}
      <div className="today-grid">
        <section className="panel today-card" aria-labelledby="waiting-title">
          <div className="section-label">Waiting for you</div>
          <h2 id="waiting-title">{pending === null ? error ? 'Approval status unavailable' : 'Checking approvals…' : pending === 0 ? 'Nothing to approve' : `${pending} action${pending === 1 ? '' : 's'} to review`}</h2>
          {pending ? <Link className="btn" href="/approvals">Open approvals</Link> : <p className="muted">Dira only asks when your policy says it should.</p>}
        </section>
        <section className="panel today-card" aria-labelledby="recent-runs-title">
          <div className="section-label">Recent repairs</div>
          <h2 id="recent-runs-title">{!loaded ? error ? 'Repair history unavailable' : 'Checking repair history…' : runs.length ? `${runs.length} recent run${runs.length === 1 ? '' : 's'}` : 'No runs yet'}</h2>
          <ul className="today-runs">
            {runs.map((run) => (
              <li key={run.id}><Link href={`/activity?workflow=${encodeURIComponent(run.id)}`}>{run.mutationSummary ?? 'Schedule plan'}</Link>
                <span className="muted"> · {label(run.status)}{run.slackFinalMin !== undefined ? ` · slack ${formatSlack(run.slackFinalMin)}` : ''}</span></li>
            ))}
          </ul>
          {session.kind === 'demo' && <Link className="btn btn-secondary" href="/try">Send the demo another email</Link>}
        </section>
      </div>
      <RelayedNotes />
      {session.kind !== 'demo' && <section className="panel"><MorningSummary /></section>}
    </main>
  );
}

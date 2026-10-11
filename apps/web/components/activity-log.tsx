'use client';

import { useEffect, useState } from 'react';
import { FlightTimeline, type FlightLine } from './flight-timeline';
import { formatSlack, label, readJson } from '../lib/format';

interface WorkflowSummary {
  id: string; kind: string; status: string; statusReason?: string; mutationSummary?: string;
  slackBeforeMin?: number; slackAfterMutationMin?: number; slackFinalMin?: number; failuresRecovered: number; replans: number;
}
interface ActionRow { actionId: string; type: string; summary: string; status: string; policyVerdict: string; externalSystem: string; verifiedAtIso?: string; approval?: { decision?: string; source?: string } }

export function ActivityLog() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [detail, setDetail] = useState<{ flight: FlightLine[]; actions: ActionRow[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/workflows', { cache: 'no-store' });
      const body = await readJson<{ workflows: WorkflowSummary[] }>(response);
      if (!response.ok) { setError(body.error ?? 'Activity could not be loaded.'); return; }
      setWorkflows(body.workflows);
      const fromUrl = new URLSearchParams(window.location.search).get('workflow');
      setSelected(fromUrl ?? body.workflows[0]?.id ?? '');
    })();
  }, []);

  useEffect(() => {
    if (!selected) return;
    void (async () => {
      const response = await fetch(`/api/workflows/${encodeURIComponent(selected)}`, { cache: 'no-store' });
      const body = await readJson<{ flight: FlightLine[]; actions: ActionRow[] }>(response);
      if (response.ok) setDetail(body);
    })();
  }, [selected]);

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!workflows.length) return <section className="panel"><p className="muted">No runs yet. Repairs appear here when an email, calendar change or feed update affects your commitments.</p></section>;

  return (
    <div className="activity-layout">
      <nav className="panel activity-list" aria-label="Runs">
        {workflows.map((run) => (
          <button key={run.id} type="button" className={run.id === selected ? 'activity-item active' : 'activity-item'} onClick={() => setSelected(run.id)}>
            <strong>{run.mutationSummary ?? label(run.kind)}</strong>
            <span className="muted">{label(run.status)} · slack {formatSlack(run.slackAfterMutationMin)} → {formatSlack(run.slackFinalMin)}{run.failuresRecovered ? ` · ${run.failuresRecovered} failure recovered` : ''}</span>
          </button>
        ))}
      </nav>
      <section className="panel activity-detail" aria-live="polite">
        {!detail ? <p className="muted">Loading…</p> : (
          <>
            <h2>Actions</h2>
            <div className="ledger-table" role="table" aria-label="Action ledger">
              {detail.actions.map((action) => (
                <div className="ledger-row" role="row" key={action.actionId}>
                  <span role="cell" className={`verdict verdict-${action.policyVerdict.toLowerCase()}`}>{label(action.policyVerdict)}</span>
                  <span role="cell">{action.summary}</span>
                  <span role="cell" className="muted">{label(action.status)}{action.approval?.decision ? ` · ${label(action.approval.decision)} via ${action.approval.source === 'telegram-callback' ? 'Telegram' : 'web'}` : ''}</span>
                </div>
              ))}
            </div>
            <h2>Flight record</h2>
            <FlightTimeline lines={detail.flight} />
          </>
        )}
      </section>
    </div>
  );
}

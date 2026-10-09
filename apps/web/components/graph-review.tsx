'use client';

import { useEffect, useState } from 'react';

type Domain = 'academic' | 'career' | 'organization' | 'personal';
type Kind = 'event' | 'block';
type Flexibility = 'FIXED' | 'MOVE_WITHIN_WINDOW' | 'FLEXIBLE' | 'OPTIONAL';
type Criticality = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

interface Proposal {
  proposalId: string;
  source: { id: string; title: string; startIso: string; endIso: string };
  draft: {
    include: boolean;
    title: string;
    domain: Domain;
    kind: Kind;
    flexibility: Flexibility;
    criticality: Criticality;
    estimatedEffortMin: number | null;
    confidence: number;
    reason: string;
  };
}

const DOMAINS: Domain[] = ['academic', 'career', 'organization', 'personal'];
const FLEXIBILITY: Flexibility[] = ['FIXED', 'MOVE_WITHIN_WINDOW', 'FLEXIBLE', 'DELEGATABLE', 'OPTIONAL'];
const CRITICALITY: Criticality[] = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'];

export function GraphReview({ timezone, onConfirmed }: { timezone: string; onConfirmed: () => void }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    fetch('/api/graph/proposals', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json() as { proposals?: Proposal[] };
        if (response.ok) setProposals(result.proposals ?? []);
      })
      .catch(() => setError('Could not load saved graph proposals.'))
      .finally(() => setLoading(false));
  }, []);

  async function generate() {
    setGenerating(true);
    setError('');
    setNotice('Reading upcoming events and asking Nemotron Nano to prepare drafts…');
    try {
      const response = await fetch('/api/graph/proposals', { method: 'POST' });
      const result = await response.json() as {
        proposals?: Proposal[]; created?: number; excluded?: number; failed?: number;
        model?: { calls: number; models: string[]; latencyMs: number; totalTokens: number };
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? 'Graph proposals could not be generated.');
      setProposals(result.proposals ?? []);
      const modelNote = result.model
        ? ` ${result.model.models.join(', ')}: ${result.model.calls} call(s), ${(result.model.latencyMs / 1000).toFixed(1)}s, ${result.model.totalTokens} tokens.`
        : '';
      setNotice(`Prepared ${result.created ?? 0} review draft(s); ${result.excluded ?? 0} calendar item(s) were skipped.${result.failed ? ` ${result.failed} item(s) need another attempt.` : ''}${modelNote}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Graph proposals could not be generated.');
      setNotice('');
    } finally {
      setGenerating(false);
    }
  }

  function edit(proposalId: string, field: keyof Proposal['draft'], value: string) {
    setProposals((current) => current.map((proposal) => proposal.proposalId === proposalId
      ? { ...proposal, draft: { ...proposal.draft, [field]: value } }
      : proposal));
  }

  async function review(proposal: Proposal, decision: 'CONFIRMED' | 'REJECTED') {
    setBusyId(proposal.proposalId);
    setError('');
    try {
      const response = await fetch('/api/graph/proposals/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          proposalId: proposal.proposalId,
          decision,
          edits: decision === 'CONFIRMED' ? {
            title: proposal.draft.title,
            domain: proposal.draft.domain,
            kind: proposal.draft.kind,
            flexibility: proposal.draft.flexibility,
            criticality: proposal.draft.criticality,
          } : undefined,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Review could not be saved.');
      setProposals((current) => current.filter((item) => item.proposalId !== proposal.proposalId));
      setNotice(decision === 'CONFIRMED' ? 'Commitment confirmed and added to your graph.' : 'Proposal rejected and remembered.');
      if (decision === 'CONFIRMED') onConfirmed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review could not be saved.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="graph-review" aria-labelledby="graph-review-title">
      <div className="graph-review-heading">
        <div>
          <div className="section-label">Your commitments</div>
          <h2 id="graph-review-title">Review calendar proposals</h2>
          <p className="muted">Nothing enters your graph until you confirm it. Authority and relationships are not inferred from calendar events.</p>
        </div>
        <button className="btn" type="button" onClick={generate} disabled={generating || loading}>
          {generating ? 'Preparing drafts…' : 'Analyze upcoming calendar'}
        </button>
      </div>
      <p className="privacy-note graph-consent">
        When you choose this action, Dira sends event titles and dates (not descriptions or attendee lists) to Nebius Token Factory for structured draft extraction. Review each draft before it is saved.
      </p>
      {loading && <p role="status" className="muted">Loading saved proposals…</p>}
      {notice && <p role="status" className="graph-notice">{notice}</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {!loading && proposals.length === 0 && <p className="muted graph-empty">No commitments are waiting for review.</p>}
      <div className="proposal-list">
        {proposals.map((proposal) => (
          <article className="proposal-card" key={proposal.proposalId}>
            <div className="proposal-source">
              <span className="section-label">Google Calendar source</span>
              <strong>{proposal.source.title}</strong>
              <time dateTime={proposal.source.startIso}>
                {formatDate(proposal.source.startIso, timezone)}
              </time>
            </div>
            <p className="proposal-reason">Nemotron Nano: {proposal.draft.reason} <span>({Math.round(proposal.draft.confidence * 100)}% confidence)</span></p>
            <div className="proposal-fields">
              <label>Title<input value={proposal.draft.title} maxLength={200} onChange={(event) => edit(proposal.proposalId, 'title', event.target.value)} /></label>
              <label>Area<select value={proposal.draft.domain} onChange={(event) => edit(proposal.proposalId, 'domain', event.target.value)}>{DOMAINS.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
              <label>Type<select value={proposal.draft.kind} onChange={(event) => edit(proposal.proposalId, 'kind', event.target.value)}><option value="event">Event</option><option value="block">Time block</option></select></label>
              <label>Flexibility<select value={proposal.draft.flexibility} onChange={(event) => edit(proposal.proposalId, 'flexibility', event.target.value)}>{FLEXIBILITY.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
              <label>Importance<select value={proposal.draft.criticality} onChange={(event) => edit(proposal.proposalId, 'criticality', event.target.value)}>{CRITICALITY.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
            </div>
            <div className="proposal-actions">
              <button className="btn" type="button" disabled={busyId === proposal.proposalId} onClick={() => review(proposal, 'CONFIRMED')}>
                {busyId === proposal.proposalId ? 'Saving…' : 'Confirm commitment'}
              </button>
              <button className="btn btn-secondary" type="button" disabled={busyId === proposal.proposalId} onClick={() => review(proposal, 'REJECTED')}>Reject</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function label(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (part) => part.toUpperCase());
}

function formatDate(value: string, timezone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
  }
  return new Intl.DateTimeFormat('en', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone,
  }).format(new Date(value));
}

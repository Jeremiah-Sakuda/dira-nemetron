'use client';

import { useEffect, useState } from 'react';

type Domain = 'academic' | 'career' | 'organization' | 'personal';
type Kind = 'event' | 'block' | 'effort';
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

interface EdgeProposal {
  proposalId: string;
  from: string;
  to: string;
  fromTitle: string;
  toTitle: string;
  type: string;
  confidence: number;
  reason: string;
  data?: { bufferMin?: number; finalBufferMin?: number; resource?: string };
}

const DOMAINS: Domain[] = ['academic', 'career', 'organization', 'personal'];
const FLEXIBILITY: Flexibility[] = ['FIXED', 'MOVE_WITHIN_WINDOW', 'FLEXIBLE', 'OPTIONAL'];
const CRITICALITY: Criticality[] = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'];

export function GraphReview({
  timezone,
  commitmentCount,
  edgeCount,
  onConfirmed,
}: {
  timezone: string;
  commitmentCount: number;
  edgeCount: number;
  onConfirmed: () => void;
}) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [edgeProposals, setEdgeProposals] = useState<EdgeProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingEdges, setGeneratingEdges] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/graph/proposals', { cache: 'no-store' }),
      fetch('/api/graph/edges', { cache: 'no-store' }),
    ])
      .then(async ([commitmentsResponse, edgesResponse]) => {
        const [commitments, edges] = await Promise.all([
          commitmentsResponse.json() as Promise<{ proposals?: Proposal[] }>,
          edgesResponse.json() as Promise<{ proposals?: EdgeProposal[] }>,
        ]);
        if (commitmentsResponse.ok) setProposals(commitments.proposals ?? []);
        if (edgesResponse.ok) setEdgeProposals(edges.proposals ?? []);
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

  async function generateEdges() {
    setGeneratingEdges(true);
    setError('');
    setNotice('Nemotron Ultra is reviewing your confirmed commitments for possible links…');
    try {
      const response = await fetch('/api/graph/edges', { method: 'POST' });
      const result = await response.json() as {
        proposals?: EdgeProposal[]; created?: number; model?: { model?: string; latencyMs?: number; totalTokens?: number };
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? 'Graph links could not be suggested.');
      setEdgeProposals(result.proposals ?? []);
      const model = result.model;
      const modelNote = model
        ? ` ${model.model ?? 'Nemotron Ultra'}: ${((model.latencyMs ?? 0) / 1000).toFixed(1)}s, ${model.totalTokens ?? 0} tokens.`
        : '';
      setNotice(`Prepared ${result.created ?? 0} link proposal(s); none affect planning before confirmation.${modelNote}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Graph links could not be suggested.');
      setNotice('');
    } finally {
      setGeneratingEdges(false);
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
            estimatedEffortMin: proposal.draft.kind === 'effort' ? proposal.draft.estimatedEffortMin : null,
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

  async function reviewEdge(proposal: EdgeProposal, decision: 'CONFIRMED' | 'REJECTED') {
    setBusyId(proposal.proposalId);
    setError('');
    try {
      const response = await fetch('/api/graph/edges/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proposalId: proposal.proposalId, decision, data: proposal.data }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Link review could not be saved.');
      setEdgeProposals((current) => current.filter((item) => item.proposalId !== proposal.proposalId));
      setNotice(decision === 'CONFIRMED' ? 'Link confirmed. It can now inform impact propagation.' : 'Link rejected and remembered.');
      if (decision === 'CONFIRMED') onConfirmed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Link review could not be saved.');
    } finally {
      setBusyId('');
    }
  }

  function editEdgeData(proposalId: string, field: 'bufferMin' | 'finalBufferMin' | 'resource', value: string) {
    setEdgeProposals((current) => current.map((proposal) => {
      if (proposal.proposalId !== proposalId) return proposal;
      const data = { ...proposal.data };
      if (field === 'resource') {
        data.resource = value;
      } else if (value === '') {
        delete data[field];
      } else {
        data[field] = Number(value);
      }
      return { ...proposal, data };
    }));
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
              <label>Type<select value={proposal.draft.kind} onChange={(event) => edit(proposal.proposalId, 'kind', event.target.value)}><option value="event">Event</option><option value="block">Time block</option><option value="effort">Task with deadline</option></select></label>
              {proposal.draft.kind === 'effort' && <label>Estimated focus time (minutes)<input type="number" min={1} max={10080} step={15} value={proposal.draft.estimatedEffortMin ?? ''} onChange={(event) => setProposals((current) => current.map((item) => item.proposalId === proposal.proposalId ? { ...item, draft: { ...item.draft, estimatedEffortMin: event.target.value === '' ? null : Number(event.target.value) } } : item))} /><span className="muted">Required before this deadline can be scheduled.</span></label>}
              <label>Flexibility<select value={proposal.draft.flexibility} onChange={(event) => edit(proposal.proposalId, 'flexibility', event.target.value)}>{FLEXIBILITY.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
              <label>Importance<select value={proposal.draft.criticality} onChange={(event) => edit(proposal.proposalId, 'criticality', event.target.value)}>{CRITICALITY.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
            </div>
            <div className="proposal-actions">
              <button className="btn" type="button" disabled={busyId === proposal.proposalId || (proposal.draft.kind === 'effort' && (!proposal.draft.estimatedEffortMin || proposal.draft.estimatedEffortMin < 1))} onClick={() => review(proposal, 'CONFIRMED')}>
                {busyId === proposal.proposalId ? 'Saving…' : 'Confirm commitment'}
              </button>
              <button className="btn btn-secondary" type="button" disabled={busyId === proposal.proposalId} onClick={() => review(proposal, 'REJECTED')}>Reject</button>
            </div>
          </article>
        ))}
      </div>
      <section className="edge-review" aria-labelledby="edge-review-title">
        <div className="edge-review-heading">
          <div>
            <h3 id="edge-review-title">Suggested links</h3>
            <p className="muted">Confirmed links are the only ones used to propagate consequences. Delegation and ownership links require explicit person evidence and are not inferred here.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={generateEdges} disabled={generatingEdges || loading || commitmentCount < 2}>
            {generatingEdges ? 'Reviewing graph…' : 'Suggest links with Ultra'}
          </button>
        </div>
        {commitmentCount < 2 && <p className="muted">Confirm two commitments before suggesting links.</p>}
        <p className="privacy-note graph-consent">
          This sends confirmed commitment titles, areas, and dates to Nebius Token Factory for relationship proposals. Names of other people are not included.
        </p>
        {edgeProposals.length === 0 && commitmentCount >= 2 && edgeCount === 0 && <p className="muted">No confirmed links yet.</p>}
        <div className="proposal-list">
          {edgeProposals.map((proposal) => (
            <article className="proposal-card edge-proposal" key={proposal.proposalId}>
              <div className="edge-endpoints">
                <strong>{proposal.fromTitle}</strong><span aria-hidden="true">→</span><strong>{proposal.toTitle}</strong>
              </div>
              <p className="edge-type">{label(proposal.type)} · {Math.round(proposal.confidence * 100)}% confidence</p>
              <p className="proposal-reason">{proposal.reason}</p>
              {edgeDataLabel(proposal) && <p className="muted edge-data">{edgeDataLabel(proposal)}</p>}
              {proposal.type === 'REQUIRES_BUFFER' && (
                <label className="edge-edit">Buffer duration (minutes)
                  <input type="number" min={0} max={10080} step={15} value={proposal.data?.bufferMin ?? ''} onChange={(event) => editEdgeData(proposal.proposalId, 'bufferMin', event.target.value)} />
                </label>
              )}
              {proposal.type === 'REQUIRES_PREPARATION' && (
                <label className="edge-edit">Finish preparation this many minutes before the event
                  <input type="number" min={0} max={10080} step={15} value={proposal.data?.finalBufferMin ?? ''} onChange={(event) => editEdgeData(proposal.proposalId, 'finalBufferMin', event.target.value)} />
                </label>
              )}
              {proposal.type === 'SHARES_RESOURCE_WITH' && (
                <label className="edge-edit">Shared resource
                  <input type="text" maxLength={120} value={proposal.data?.resource ?? ''} onChange={(event) => editEdgeData(proposal.proposalId, 'resource', event.target.value)} />
                </label>
              )}
              <div className="proposal-actions">
                <button className="btn" type="button" disabled={busyId === proposal.proposalId} onClick={() => reviewEdge(proposal, 'CONFIRMED')}>Confirm link</button>
                <button className="btn btn-secondary" type="button" disabled={busyId === proposal.proposalId} onClick={() => reviewEdge(proposal, 'REJECTED')}>Reject</button>
              </div>
            </article>
          ))}
        </div>
      </section>
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

function edgeDataLabel(proposal: EdgeProposal): string {
  if (proposal.data?.bufferMin !== undefined) return `Suggested buffer: ${proposal.data.bufferMin} minutes`;
  if (proposal.data?.finalBufferMin !== undefined) return `Preparation complete ${proposal.data.finalBufferMin} minutes before the event`;
  if (proposal.data?.resource) return `Shared resource: ${proposal.data.resource}`;
  return '';
}

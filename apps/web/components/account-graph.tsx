'use client';

import { useEffect, useState } from 'react';
import { formatWhen, label, readJson } from '../lib/format';
import { useSession } from '../lib/use-session';

interface Node { id: string; title: string; domain: string; kind: string; flexibility: string; criticality: string; owner: string; startIso: string | null; deadlineIso: string | null; authority: string[] }
interface Edge { id: string; type: string; from: string; to: string }
interface Source { commitmentId: string; title: string; domain: string }
interface Graph { timezone?: string; commitments: Node[]; edges: Edge[]; sources: Source[]; sourceChecks?: { tavily: boolean; liveModel: boolean } }

const DOMAINS = ['academic', 'career', 'organization', 'personal'];

export function AccountGraph() {
  const session = useSession();
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState('');
  const [sourceFor, setSourceFor] = useState('');
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState('');

  async function load() {
    const response = await fetch('/api/account-graph', { cache: 'no-store' });
    const body = await readJson<Graph>(response);
    if (!response.ok) { setError(body.error ?? 'Your graph could not be loaded.'); return; }
    setGraph(body);
  }
  useEffect(() => { if (session.status === 'signed-in') void load(); }, [session.status]);

  async function saveSource() {
    setBusy('save'); setError('');
    const response = await fetch('/api/source-checks', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commitmentId: sourceFor, domain }),
    });
    const body = await readJson(response);
    if (!response.ok) setError(body.error ?? 'The source could not be saved.');
    else { setDomain(''); setSourceFor(''); await load(); }
    setBusy('');
  }

  async function check(source: Source) {
    setBusy(source.commitmentId); setError(''); setResult('');
    const response = await fetch('/api/source-checks/run', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commitmentId: source.commitmentId }),
    });
    const body = await readJson<{ results: number; considered: { url: string; status: string; reason?: string }[] }>(response);
    if (!response.ok) setError(body.error ?? 'The check failed.');
    else setResult(`Tavily returned ${body.results} result(s) from ${source.domain}: ${body.considered.map((item) => `${label(item.status)}${item.reason ? ` (${item.reason})` : ''}`).join('; ') || 'nothing on the official domain'}.`);
    setBusy('');
    await load();
  }

  if (session.status === 'signed-out') return <section className="panel"><p>Sign in or start the demo to see a graph.</p></section>;
  if (!graph) return error ? <p className="form-error" role="alert">{error}</p> : <p className="muted" role="status">Loading…</p>;

  return (
    <div className="account-graph">
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="graph-columns">
        {DOMAINS.map((area) => {
          const nodes = graph.commitments.filter((node) => node.domain === area);
          return (
            <section className="panel graph-column" key={area} aria-labelledby={`col-${area}`}>
              <h2 id={`col-${area}`}>{label(area)}</h2>
              {nodes.length === 0 ? <p className="muted">Nothing yet.</p> : nodes.map((node) => (
                <article className="graph-node" key={node.id} data-domain={node.domain}>
                  <strong>{node.title}</strong>
                  <span className="muted">{node.startIso ? formatWhen(node.startIso, graph.timezone) : node.deadlineIso ? `due ${formatWhen(node.deadlineIso, graph.timezone)}` : label(node.kind)} · {label(node.flexibility)}</span>
                  {node.authority.length > 0 && <span className="muted">Authority: {node.authority.join(', ')}</span>}
                  {graph.sources.filter((source) => source.commitmentId === node.id).map((source) => <span className="muted" key={source.domain}>Official page: {source.domain}</span>)}
                </article>
              ))}
            </section>
          );
        })}
      </div>
      <section className="panel" aria-labelledby="links-title">
        <h2 id="links-title">Links Dira reasons over</h2>
        {graph.edges.length === 0 ? <p className="muted">No links yet. After two commitments are confirmed, Nemotron Ultra can suggest typed links for you to review.</p> : (
          <ul className="edge-list">{graph.edges.map((edge) => (
            <li key={edge.id}><span className="verdict">{label(edge.type)}</span> {edge.from} → {edge.to}</li>
          ))}</ul>
        )}
      </section>
      <section className="panel" aria-labelledby="sources-title">
        <h2 id="sources-title">Official sources</h2>
        <p className="muted">Name the public page that is the source of truth for a commitment, such as a course&rsquo;s exam page. Dira searches only that domain with Tavily, and a date change it finds goes through the same checks as an email: Nemotron interprets it, the quote must appear on the page, and you approve anything sensitive. Dira never contacts a web source.</p>
        {!graph.sourceChecks?.tavily && <p className="footnote">Tavily is not configured on this deployment, so checks cannot run here yet.</p>}
        <ul className="edge-list">{graph.sources.map((source) => (
          <li key={source.commitmentId}>{source.title} · <span className="mono">{source.domain}</span>{' '}
            <button className="btn btn-secondary" type="button" disabled={busy === source.commitmentId || !graph.sourceChecks?.tavily || session.kind === 'demo'} onClick={() => void check(source)}>
              {busy === source.commitmentId ? 'Checking…' : 'Check now'}
            </button></li>
        ))}</ul>
        {result && <p className="graph-notice" role="status">{result}</p>}
        <div className="source-form">
          <select aria-label="Commitment" value={sourceFor} onChange={(event) => setSourceFor(event.target.value)}>
            <option value="">Choose a commitment…</option>
            {graph.commitments.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
          </select>
          <input aria-label="Official domain" placeholder="econ402.university.edu" value={domain} onChange={(event) => setDomain(event.target.value)} />
          <button className="btn" type="button" disabled={!sourceFor || !domain || busy === 'save'} onClick={() => void saveSource()}>Save source</button>
        </div>
      </section>
    </div>
  );
}

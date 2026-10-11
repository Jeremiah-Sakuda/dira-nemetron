'use client';

import { useEffect, useState } from 'react';
import { readJson } from '../lib/format';

interface Confirmed { id: string; kind: string; sentence: string }
interface CandidateRow { candidateId: string; sentence: string; source: { summary: string }; createdAtIso: string }

export function RulesPanel() {
  const [confirmed, setConfirmed] = useState<Confirmed[]>([]);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const response = await fetch('/api/rules', { cache: 'no-store' });
    const body = await readJson<{ confirmed: Confirmed[]; candidates: CandidateRow[] }>(response);
    if (!response.ok) { setError(body.error ?? 'Rules could not be loaded.'); return; }
    setConfirmed(body.confirmed); setCandidates(body.candidates);
  }
  useEffect(() => { void load(); }, []);

  async function decide(candidate: CandidateRow, decision: 'CONFIRMED' | 'DISMISSED') {
    setBusy(candidate.candidateId); setError('');
    const response = await fetch(`/api/rules/candidates/${candidate.candidateId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }),
    });
    if (!response.ok) setError((await readJson(response)).error ?? 'The decision could not be saved.');
    setBusy('');
    await load();
  }

  async function remove(rule: Confirmed) {
    setBusy(rule.id); setError('');
    const response = await fetch(`/api/rules/${rule.id}`, { method: 'DELETE' });
    if (!response.ok) setError((await readJson(response)).error ?? 'The rule could not be removed.');
    setBusy('');
    await load();
  }

  return (
    <div className="rules-layout">
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="panel" aria-labelledby="candidates-title">
        <h2 id="candidates-title">Suggested from your corrections</h2>
        {candidates.length === 0 ? <p className="muted">No suggestions waiting. Correct a step in Approvals to create one.</p> : candidates.map((candidate) => (
          <article className="rule-card" key={candidate.candidateId}>
            <p className="rule-sentence">{candidate.sentence}</p>
            <p className="muted">From your correction of “{candidate.source.summary}”</p>
            <div className="proposal-actions">
              <button className="btn" type="button" disabled={busy === candidate.candidateId} onClick={() => void decide(candidate, 'CONFIRMED')}>Confirm</button>
              <button className="btn btn-secondary" type="button" disabled={busy === candidate.candidateId} onClick={() => void decide(candidate, 'DISMISSED')}>Dismiss</button>
            </div>
          </article>
        ))}
      </section>
      <section className="panel" aria-labelledby="confirmed-title">
        <h2 id="confirmed-title">Active rules</h2>
        {confirmed.length === 0 ? <p className="muted">No active rules yet.</p> : confirmed.map((rule) => (
          <article className="rule-card active" key={rule.id}>
            <p className="rule-sentence">{rule.sentence}</p>
            <p className="muted mono">skills/dira/{rule.id}/SKILL.md</p>
            <button className="btn btn-secondary" type="button" disabled={busy === rule.id} onClick={() => void remove(rule)}>Remove rule</button>
          </article>
        ))}
        <p className="footnote">Download your memory repository (graph, policy, rules and Skills) as a Git bundle from <a href="/api/memory/export">Export memory</a>.</p>
      </section>
    </div>
  );
}

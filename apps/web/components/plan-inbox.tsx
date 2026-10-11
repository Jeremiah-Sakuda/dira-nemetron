'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatSlack, label, readJson } from '../lib/format';

interface PendingApproval { actionId: string; workflowId: string; summary: string; policyRule: string; requestedAtIso?: string }
interface RecentDecision { actionId: string; decision: string; decidedAtIso: string; summary: string; status: string | null }
interface PlanAction {
  actionId: string; type: string; summary: string; status: string; policyVerdict: string; policyRule: string;
  provenance: string[]; externalSystem: string; approval?: { decision?: string; source?: string };
}
interface PlanRun {
  id: string; kind?: string; status: string; statusReason?: string; mutationSummary?: string;
  slackAfterMutationMin?: number; planningRounds?: { id: string; slackMinutes: number; source?: string; acceptable: boolean }[][];
  selectedPlanIds?: string[];
}
interface Plan { run: PlanRun; actions: PlanAction[] }
interface Candidate { candidateId: string; sentence: string }

const REASONS = [
  { value: 'not-this-time', label: 'Not at that time' },
  { value: 'protect', label: 'Don’t touch this commitment' },
  { value: 'never-contact', label: 'Don’t contact this person' },
  { value: 'ask-first', label: 'Always ask me first for this' },
] as const;

/** Plans waiting for the owner. The decision is recorded from this authenticated session, never from a model. */
export function PlanInbox({ workflowId, compact = false, onChanged }: { workflowId?: string; compact?: boolean; onChanged?: () => void | Promise<void> }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [recent, setRecent] = useState<RecentDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [candidates, setCandidates] = useState<Record<string, Candidate>>({});
  const [reasonFor, setReasonFor] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/approvals', { cache: 'no-store' });
      const body = await readJson<{ approvals?: PendingApproval[]; recentDecisions?: RecentDecision[] }>(response);
      if (!response.ok) throw new Error(body.error ?? 'Approvals could not be loaded.');
      const ids = [...new Set((body.approvals ?? []).map((item) => item.workflowId))]
        .filter((id) => !workflowId || id === workflowId);
      const loaded = await Promise.all(ids.map(async (id) => {
        const planResponse = await fetch(`/api/workflows/${encodeURIComponent(id)}`, { cache: 'no-store' });
        const plan = await readJson<Plan>(planResponse);
        return planResponse.ok ? plan : undefined;
      }));
      setPlans(loaded.filter((plan): plan is Plan => Boolean(plan)));
      setRecent(body.recentDecisions ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setLoading(false); }
  }, [workflowId]);

  useEffect(() => { void load(); }, [load]);

  async function decide(action: PlanAction, decision: 'APPROVED' | 'REJECTED') {
    setBusy(action.actionId); setError(''); setNotice('');
    try {
      const correction = decision === 'REJECTED' ? reasonFor[action.actionId] : undefined;
      const response = await fetch('/api/approvals', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actionId: action.actionId, decision, ...(correction ? { correction } : {}) }),
      });
      const body = await readJson<{ execution?: { status: string; verifiedActions?: number; reason?: string }; ruleCandidate?: Candidate; workflowId?: string }>(response);
      if (!response.ok) throw new Error(body.error ?? 'The decision could not be recorded.');
      if (body.ruleCandidate && body.workflowId) setCandidates((current) => ({ ...current, [body.workflowId!]: body.ruleCandidate! }));
      setNotice(decision === 'REJECTED'
        ? 'Rejected. Nothing in this plan will run.'
        : body.execution?.status === 'RESOLVED'
          ? `Approved. Dira revalidated the plan, ran it, and verified ${body.execution.verifiedActions ?? 0} action(s) by reading each surface back.`
          : body.execution?.reason ?? 'Approval recorded.');
      await load();
      await onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(''); }
  }

  async function correct(plan: Plan, action: PlanAction) {
    const reason = reasonFor[action.actionId];
    if (!reason) return;
    setBusy(action.actionId); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/workflows/${encodeURIComponent(plan.run.id)}/corrections`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actionId: action.actionId, reason }),
      });
      const body = await readJson<{ ruleCandidate?: Candidate }>(response);
      if (!response.ok || !body.ruleCandidate) throw new Error(body.error ?? 'No rule could be derived from that correction.');
      setCandidates((current) => ({ ...current, [plan.run.id]: body.ruleCandidate! }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(''); }
  }

  async function confirmAndReplan(plan: Plan, candidate: Candidate, confirm: boolean) {
    setBusy(candidate.candidateId); setError(''); setNotice('');
    try {
      const decided = await fetch(`/api/rules/candidates/${candidate.candidateId}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: confirm ? 'CONFIRMED' : 'DISMISSED' }),
      });
      if (!decided.ok) throw new Error((await readJson(decided)).error ?? 'The rule could not be saved.');
      setCandidates((current) => { const next = { ...current }; delete next[plan.run.id]; return next; });
      if (confirm && plan.run.kind === 'event-repair') {
        const replanned = await fetch(`/api/workflows/${encodeURIComponent(plan.run.id)}/replan`, { method: 'POST' });
        const body = await readJson<{ run?: PlanRun }>(replanned);
        if (!replanned.ok) throw new Error(body.error ?? 'Dira could not plan again.');
        setNotice(`Rule saved to your memory repo. New plan: ${label(body.run?.status ?? 'unknown')}.`);
      } else {
        setNotice(confirm ? 'Rule saved to your memory repo. Future plans follow it.' : 'Suggestion dismissed.');
      }
      await load();
      await onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(''); }
  }

  return (
    <div className={compact ? 'plan-inbox compact' : 'plan-inbox'} aria-busy={loading}>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="graph-notice" role="status">{notice}</p>}
      {loading && plans.length === 0 && <p className="muted" role="status">Loading…</p>}
      {!loading && plans.length === 0 && <p className="muted">Nothing is waiting for your decision.</p>}
      {plans.map((plan) => {
        const candidate = candidates[plan.run.id];
        const round = plan.run.planningRounds?.[plan.run.planningRounds.length - 1];
        const selected = round?.find((item) => item.id === plan.run.selectedPlanIds?.[plan.run.selectedPlanIds.length - 1]);
        const open = plan.actions.filter((action) => ['AWAITING_APPROVAL', 'AUTHORIZED'].includes(action.status));
        const study = open.filter((action) => action.policyRule === 'restructure-study-blocks' && action.status !== 'AWAITING_APPROVAL');
        const pending = open.filter((action) => !study.includes(action));
        return (
          <article className="plan-card" key={plan.run.id}>
            <header className="plan-card-header">
              <div>
                <div className="section-label">{plan.run.kind === 'event-repair' ? 'Repair plan' : 'Schedule plan'}{selected?.source === 'nemotron-ultra' ? ' · proposed by Nemotron Ultra' : ''}</div>
                <h3>{plan.run.mutationSummary ?? 'Plan awaiting review'}</h3>
              </div>
              {selected && <span className="slack-badge positive">Restores slack to {formatSlack(selected.slackMinutes)}</span>}
            </header>
            <ul className="plan-actions">
              {pending.map((action) => (
                <li key={action.actionId} className={action.status === 'AWAITING_APPROVAL' ? 'plan-action gated' : 'plan-action'}>
                  <div className="plan-action-main">
                    <span className={`verdict verdict-${action.policyVerdict.toLowerCase()}`}>{label(action.policyVerdict)}</span>
                    <span className="plan-action-summary">{action.summary}</span>
                  </div>
                  {!compact && <div className="plan-action-why">Rule {label(action.policyRule)} · authorized by {action.provenance.join(', ')}</div>}
                  <div className="plan-action-controls">
                    {action.status === 'AWAITING_APPROVAL' && (
                      <>
                        <button className="btn" type="button" disabled={busy === action.actionId} onClick={() => void decide(action, 'APPROVED')}>
                          {busy === action.actionId ? 'Working…' : 'Approve'}
                        </button>
                        <button className="btn btn-secondary" type="button" disabled={busy === action.actionId} onClick={() => void decide(action, 'REJECTED')}>Reject</button>
                      </>
                    )}
                    {plan.run.kind === 'event-repair' && (
                      <span className="correct-control">
                        <select aria-label={`Correct “${action.summary}”`} value={reasonFor[action.actionId] ?? ''}
                          onChange={(event) => setReasonFor((current) => ({ ...current, [action.actionId]: event.target.value }))}>
                          <option value="">{action.status === 'AWAITING_APPROVAL' ? 'Reason (optional)…' : 'Correct this…'}</option>
                          {REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
                        </select>
                        {action.status !== 'AWAITING_APPROVAL' && reasonFor[action.actionId] && (
                          <button className="btn btn-secondary" type="button" disabled={busy === action.actionId} onClick={() => void correct(plan, action)}>Suggest rule</button>
                        )}
                      </span>
                    )}
                  </div>
                </li>
              ))}
              {study.length > 0 && (
                <li className="plan-action">
                  <details>
                    <summary className="plan-action-main">
                      <span className="verdict verdict-allow">Allow</span>
                      <span className="plan-action-summary">Rebuild the study plan around the new exam time ({study.length} calendar changes)</span>
                    </summary>
                    <ul className="study-steps">{study.map((action) => <li key={action.actionId}>{action.summary}</li>)}</ul>
                  </details>
                </li>
              )}
            </ul>
            {candidate && (
              <div className="rule-candidate" role="status">
                <div className="section-label">Suggested rule · not active until you confirm</div>
                <p>{candidate.sentence}</p>
                <div className="proposal-actions">
                  <button className="btn" type="button" disabled={busy === candidate.candidateId} onClick={() => void confirmAndReplan(plan, candidate, true)}>
                    {busy === candidate.candidateId ? 'Saving…' : plan.run.kind === 'event-repair' ? 'Confirm rule and replan' : 'Confirm rule'}
                  </button>
                  <button className="btn btn-secondary" type="button" disabled={busy === candidate.candidateId} onClick={() => void confirmAndReplan(plan, candidate, false)}>Dismiss</button>
                </div>
              </div>
            )}
          </article>
        );
      })}
      {!compact && recent.length > 0 && (
        <section className="recent-decisions" aria-labelledby="recent-title">
          <h3 id="recent-title">Recent decisions</h3>
          {recent.map((item) => (
            <div className="recent-decision" key={`${item.actionId}-${item.decidedAtIso}`}>
              <div><strong>{item.summary}</strong><span className="muted"> · {label(item.decision)}{item.status ? ` · ${label(item.status)}` : ''}</span></div>
              <time dateTime={item.decidedAtIso}>{new Date(item.decidedAtIso).toLocaleString()}</time>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';

interface DailySummary {
  localDate: string;
  timezone: string;
  generatedAtIso: string;
  globalSlackMinutes: number;
  violations: { type: string; detail: string }[];
  plans: { id: string; label: string; acceptable: boolean; requestable: boolean; rejectionReason?: string; actions: { type: string; summary: string; policyVerdict: string }[] }[];
  calendarFenced: boolean;
}

export function MorningSummary() {
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/account/morning-summary', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json() as { summary?: { report: DailySummary } | null; error?: string };
        if (!response.ok) throw new Error(result.error ?? 'Your morning summary could not be loaded.');
        setSummary(result.summary?.report ?? null);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Your morning summary could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="morning-summary" aria-labelledby="morning-summary-title" aria-busy={loading}>
      <div className="section-label">Daily check-in</div>
      <h2 id="morning-summary-title">Morning summary</h2>
      {loading ? <p role="status" className="muted">Loading your latest schedule check…</p>
        : error ? <p className="form-error" role="alert">{error}</p>
          : !summary ? <p className="muted">Your summary appears here after the daily schedule job runs. Background jobs must be enabled for your account by the deployment operator.</p>
            : <>
              <p className="muted">{formatLocalDate(summary.localDate, summary.timezone)} · checked {new Date(summary.generatedAtIso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: summary.timezone })}</p>
              <div className="morning-summary-stats">
                <strong>{summary.violations.length ? `${summary.violations.length} schedule issue(s)` : 'No current schedule issues'}</strong>
                <span className={summary.globalSlackMinutes < 0 ? 'schedule-slack negative' : 'schedule-slack'}>Global slack {formatSlack(summary.globalSlackMinutes)}</span>
              </div>
              {summary.calendarFenced && <p className="privacy-note">Google Calendar is fenced. Calendar-derived commitments are excluded from this check.</p>}
              {summary.violations.map((item, index) => <p className="schedule-violation" key={`${item.type}-${index}`}><strong>{label(item.type)}:</strong> {item.detail}</p>)}
              {summary.plans.length > 0 && <div className="morning-summary-plans">
                <h3>Deterministic repair options</h3>
                {summary.plans.map((plan) => <article key={plan.id}>
                  <strong>{plan.label}</strong>
                  <span className="muted">{plan.acceptable ? 'Feasible under current policy' : plan.rejectionReason ?? (plan.requestable ? 'Approval required' : 'Needs review')}</span>
                  {plan.actions.map((action, index) => <p key={`${action.type}-${index}`}>{action.summary} <span className="muted">· {label(action.policyVerdict)}</span></p>)}
                </article>)}
              </div>}
              {summary.plans.length > 0 && <a className="btn btn-secondary" href="#schedule-check">Open current repair options</a>}
              <p className="footnote">These are deterministic suggestions. A summary never executes actions or grants approval.</p>
            </>}
    </section>
  );
}

function formatLocalDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', timeZone: timezone })
    .format(new Date(`${value}T12:00:00Z`));
}

function formatSlack(minutes: number): string {
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  return `${minutes < 0 ? '−' : ''}${hours ? `${hours}h ` : ''}${remainder}m`;
}

function label(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (part) => part.toUpperCase());
}

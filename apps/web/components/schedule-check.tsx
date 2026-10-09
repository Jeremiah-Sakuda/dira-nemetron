'use client';

import { useEffect, useState } from 'react';

type AvailabilityProfile = { weekdays: number[]; startMinute: number; endMinute: number };
type ScheduleAnalysis = {
  checkedAtIso: string;
  feasibility: { globalSlackMinutes: number; violations: { type: string; detail: string }[] };
  plans: { id: string; label: string; acceptable: boolean; requestable: boolean; approvalRequired: boolean; rejectionReason?: string; slackMinutes: number; actions: { type: string; summary: string; policyVerdict: string }[] }[];
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function ScheduleCheck() {
  const [profile, setProfile] = useState<AvailabilityProfile>({ weekdays: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020 });
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [requestingPlanId, setRequestingPlanId] = useState('');
  const [requestedPlans, setRequestedPlans] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<ScheduleAnalysis | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    fetch('/api/availability', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json() as { profile?: AvailabilityProfile | null };
        if (response.ok && result.profile) {
          setProfile(result.profile);
          setConfigured(true);
          await check();
        }
      })
      .catch(() => setError('Focus hours could not be loaded.'));
  // Load once when the account setup page mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleDay(day: number) {
    setProfile((current) => ({
      ...current,
      weekdays: current.weekdays.includes(day)
        ? current.weekdays.filter((item) => item !== day)
        : [...current.weekdays, day].sort((a, b) => a - b),
    }));
  }

  async function save() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/availability', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const result = await response.json() as { error?: string; issues?: { message: string }[] };
      if (!response.ok) throw new Error(result.issues?.[0]?.message ?? result.error ?? 'Focus hours could not be saved.');
      setConfigured(true);
      setNotice('Focus hours saved for the next 90 days in your calendar timezone.');
      await check();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Focus hours could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function check() {
    setChecking(true);
    setError('');
    try {
      const response = await fetch('/api/graph/analysis', { cache: 'no-store' });
      const result = await response.json() as ScheduleAnalysis & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Schedule could not be checked.');
      setAnalysis(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Schedule could not be checked.');
    } finally {
      setChecking(false);
    }
  }

  async function requestApproval(planId: string) {
    setRequestingPlanId(planId);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/graph/analysis', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      const result = await response.json() as { error?: string; approvalCount?: number };
      if (!response.ok) throw new Error(result.error ?? 'Approval request could not be created.');
      setRequestedPlans((current) => [...new Set([...current, planId])]);
      setNotice(`${result.approvalCount ?? 0} approval request(s) saved. No external action has run.`);
      await check();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Approval request could not be created.');
    } finally {
      setRequestingPlanId('');
    }
  }

  return (
    <section className="schedule-check" aria-labelledby="schedule-check-title">
      <div className="section-label">Make plans usable</div>
      <h2 id="schedule-check-title">Set your focus hours</h2>
      <p className="muted">Dira uses these local-time windows to estimate capacity for deadline work. Events already in your confirmed graph are treated as busy time.</p>
      <fieldset className="weekday-picker">
        <legend>Days you can usually focus</legend>
        {DAYS.map((day, index) => (
          <label key={day} className="weekday-option">
            <input type="checkbox" checked={profile.weekdays.includes(index)} onChange={() => toggleDay(index)} />
            <span>{day.slice(0, 3)}</span>
          </label>
        ))}
      </fieldset>
      <div className="availability-times">
        <label>From<select value={profile.startMinute} onChange={(event) => setProfile((current) => ({ ...current, startMinute: Number(event.target.value) }))}>{timeOptions().map((minute) => <option key={minute} value={minute}>{formatTime(minute)}</option>)}</select></label>
        <label>Until<select value={profile.endMinute} onChange={(event) => setProfile((current) => ({ ...current, endMinute: Number(event.target.value) }))}>{timeOptions(true).map((minute) => <option key={minute} value={minute}>{formatTime(minute)}</option>)}</select></label>
        <button type="button" className="btn" onClick={save} disabled={saving || profile.weekdays.length === 0 || profile.endMinute - profile.startMinute < 60}>{saving ? 'Saving…' : configured ? 'Update focus hours' : 'Save focus hours'}</button>
      </div>
      <p className="privacy-note">These hours stay in your account state. Dira does not change your calendar when checking a schedule.</p>
      {notice && <p className="graph-notice" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {configured && (
        <div className="schedule-results">
          <button type="button" className="btn btn-secondary" onClick={check} disabled={checking}>{checking ? 'Checking…' : 'Check my schedule'}</button>
          {analysis && <div className="schedule-result" aria-live="polite">
            <div className="schedule-result-heading">
              <strong>{analysis.feasibility.violations.length ? `${analysis.feasibility.violations.length} feasibility issue(s) found` : 'No current feasibility issues'}</strong>
              <span className={analysis.feasibility.globalSlackMinutes < 0 ? 'schedule-slack negative' : 'schedule-slack'}>Global slack {formatSlack(analysis.feasibility.globalSlackMinutes)}</span>
            </div>
            {analysis.feasibility.violations.map((violation, index) => <p className="schedule-violation" key={`${violation.type}-${index}`}><strong>{label(violation.type)}:</strong> {violation.detail}</p>)}
            {analysis.plans.length > 0 && <div className="schedule-plans">
              <h3>Deterministic repair candidates</h3>
              {analysis.plans.map((plan) => <article className="schedule-plan" key={plan.id}>
                <strong>{plan.label}</strong><span className={plan.acceptable ? 'schedule-plan-status good' : 'schedule-plan-status'}>{plan.acceptable ? 'Feasible under current policy' : plan.rejectionReason ?? 'Needs review'}</span>
                {plan.actions.map((action, index) => <p key={`${action.type}-${index}`}>{action.summary}<span className="muted"> · {label(action.policyVerdict)}</span></p>)}
                {plan.requestable && (requestedPlans.includes(plan.id)
                  ? <span className="schedule-plan-status">Approval request recorded · no execution</span>
                  : <button type="button" className="btn btn-secondary" disabled={requestingPlanId === plan.id} onClick={() => void requestApproval(plan.id)}>{requestingPlanId === plan.id ? 'Saving request…' : 'Request user approval'}</button>)}
              </article>)}
            </div>}
            <p className="footnote">Checked {new Date(analysis.checkedAtIso).toLocaleString()}. Suggestions are previews; external changes still need an approval workflow and write access.</p>
          </div>}
        </div>
      )}
    </section>
  );
}

function timeOptions(includeEndOfDay = false): number[] {
  const values = Array.from({ length: includeEndOfDay ? 49 : 48 }, (_, index) => index * 30);
  return includeEndOfDay ? values.filter((minute) => minute >= 60) : values;
}

function formatTime(minute: number): string {
  if (minute === 1440) return '12:00 AM (next day)';
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2020, 0, 1, Math.floor(minute / 60), minute % 60)));
}

function formatSlack(minute: number): string {
  const absolute = Math.abs(minute);
  const hours = Math.floor(absolute / 60);
  const remainingMinutes = absolute % 60;
  return `${minute < 0 ? '−' : ''}${hours ? `${hours}h ` : ''}${remainingMinutes}m`;
}

function label(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (part) => part.toUpperCase());
}

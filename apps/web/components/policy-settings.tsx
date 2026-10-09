'use client';

import { useEffect, useState } from 'react';

const OPTIONS = [
  {
    rule: 'move-flexible-or-optional-blocks',
    label: 'Ask me before moving flexible or optional commitments',
    detail: 'Overrides automatic moves for commitments Dira already considers flexible or optional.',
  },
  {
    rule: 'restructure-study-blocks',
    label: 'Ask me before adding or removing study blocks',
    detail: 'Keeps study-plan changes behind your approval, even when deterministic policy permits them.',
  },
  {
    rule: 'delegate-explicitly-delegatable',
    label: 'Ask me before delegating to a named backup',
    detail: 'Keeps delegation approval-required even when you have marked the commitment and person as a valid pair.',
  },
] as const;

type RuleId = typeof OPTIONS[number]['rule'];
interface PolicySettings {
  schemaVersion: 1;
  fencedCalendarIds: ('primary')[];
  calendarAutoSync: boolean;
  requireApproval: { rule: RuleId; scope?: { domain?: string; commitmentId?: string } }[];
}
interface PolicyBlockEvent {
  eventId: string;
  actionType: string;
  targetId: string;
  policyRule: string;
  reason: string;
  createdAtIso: string;
}

const DEFAULT_POLICY: PolicySettings = { schemaVersion: 1, fencedCalendarIds: [], calendarAutoSync: false, requireApproval: [] };

export function PolicySettingsForm() {
  const [policy, setPolicy] = useState<PolicySettings>(DEFAULT_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [blockedEvents, setBlockedEvents] = useState<PolicyBlockEvent[]>([]);

  useEffect(() => {
    fetch('/api/policy/settings', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json() as { policy?: PolicySettings; error?: string };
        if (!response.ok) throw new Error(result.error ?? 'Sign in to edit your policy.');
        setPolicy(result.policy ?? DEFAULT_POLICY);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Policy settings could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch('/api/policy/blocked-events', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const result = await response.json() as { events?: PolicyBlockEvent[] };
        setBlockedEvents(result.events ?? []);
      })
      .catch(() => undefined);
  }, []);

  function setRule(rule: RuleId, enabled: boolean) {
    setPolicy((current) => ({
      ...current,
      requireApproval: [
        ...current.requireApproval.filter((item) => item.rule !== rule),
        ...(enabled ? [{ rule }] : []),
      ],
    }));
    setNotice('');
  }

  function setPrimaryCalendarFenced(enabled: boolean) {
    setPolicy((current) => ({
      ...current,
      fencedCalendarIds: enabled ? ['primary'] : [],
    }));
    setNotice('');
  }

  function setCalendarAutoSync(enabled: boolean) {
    setPolicy((current) => ({ ...current, calendarAutoSync: enabled }));
    setNotice('');
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/policy/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(policy),
      });
      const result = await response.json() as { policy?: PolicySettings; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Policy settings could not be saved.');
      setPolicy(result.policy ?? policy);
      setNotice('Your approval rules are saved and will apply to the next schedule check.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Policy settings could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel policy-settings" aria-labelledby="personal-policy-title" aria-busy={loading || saving}>
      <div className="section-label">Your account</div>
      <h2 id="personal-policy-title">Approval rules</h2>
      <p className="muted">
        These settings can add approval steps to actions the deterministic policy already permits.
        They cannot grant Dira new authority or override a denial.
      </p>
      {loading ? <p role="status" className="muted">Loading your settings…</p> : (
        <form onSubmit={save}>
          <fieldset className="policy-rule-list" disabled={saving}>
            <legend>Actions that always require your approval</legend>
            {OPTIONS.map((option) => (
              <label className="policy-rule" key={option.rule}>
                <input
                  type="checkbox"
                  checked={policy.requireApproval.some((item) => item.rule === option.rule)}
                  onChange={(event) => setRule(option.rule, event.currentTarget.checked)}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.detail}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset className="policy-rule-list policy-fence-list" disabled={saving}>
            <legend>Sources Dira must not access</legend>
            <label className="policy-rule">
              <input
                type="checkbox"
                checked={policy.fencedCalendarIds.includes('primary')}
                onChange={(event) => setPrimaryCalendarFenced(event.currentTarget.checked)}
              />
              <span>
                <strong>Fence my primary Google Calendar</strong>
                <small>Stops future reads and changes through Dira. Previously confirmed Calendar facts stay stored but are excluded from schedule checks and approvals until you re-enable access.</small>
              </span>
            </label>
          </fieldset>
          <fieldset className="policy-rule-list policy-fence-list" disabled={saving}>
            <legend>Automatic source checks</legend>
            <label className="policy-rule">
              <input
                type="checkbox"
                checked={policy.calendarAutoSync}
                onChange={(event) => setCalendarAutoSync(event.currentTarget.checked)}
              />
              <span>
                <strong>Check Calendar for changes every five minutes</strong>
                <small>When this deployment has background checks enabled for your account, new Calendar items are sent to Nebius Token Factory for draft extraction. Changes to confirmed commitments are proposed for your review. Turn this off to stop scheduled reads; use Sync Calendar changes for a one-time check.</small>
              </span>
            </label>
          </fieldset>
          <div className="policy-save-row">
            <button className="btn" type="submit" disabled={saving || loading}>
              {saving ? 'Saving…' : 'Save policy settings'}
            </button>
            {notice && <span className="policy-feedback" role="status">{notice}</span>}
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>
      )}
      <section className="policy-blocks" aria-labelledby="policy-blocks-title">
        <h3 id="policy-blocks-title">Recent policy denials</h3>
        {blockedEvents.length === 0 ? (
          <p className="muted" role="status">No blocked plan actions have been recorded for this account.</p>
        ) : (
          <ol>
            {blockedEvents.slice(0, 10).map((event) => (
              <li key={event.eventId}>
                <time dateTime={event.createdAtIso}>{new Date(event.createdAtIso).toLocaleString()}</time>
                <strong>{event.actionType} · {event.policyRule}</strong>
                <span>{event.reason}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}

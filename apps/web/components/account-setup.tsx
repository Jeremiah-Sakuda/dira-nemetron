'use client';

import { useEffect, useRef, useState } from 'react';
import { GraphReview } from './graph-review';
import { ScheduleCheck } from './schedule-check';

interface Account {
  email: string;
  timezone: string;
}

interface AccountStateSummary {
  commitmentCount: number;
  edgeCount: number;
  timezone: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  startIso: string;
  endIso: string;
}

export function AccountSetup() {
  const [account, setAccount] = useState<Account | null>(null);
  const [stateSummary, setStateSummary] = useState<AccountStateSummary | null>(null);
  const [calendarWriteEnabled, setCalendarWriteEnabled] = useState(false);
  const [gmailReadEnabled, setGmailReadEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [memoryImporting, setMemoryImporting] = useState(false);
  const [memoryNotice, setMemoryNotice] = useState('');
  const memoryFileInput = useRef<HTMLInputElement>(null);
  const [scheduleRevision, setScheduleRevision] = useState(0);

  useEffect(() => {
    const authError = new URLSearchParams(window.location.search).get('auth_error');
    if (authError) {
      setError(authError === 'google'
        ? 'Google sign-in was cancelled or could not be verified. Try again.'
        : 'Dira could not reach the sign-in service. Try again in a moment.');
    }
    fetch('/api/me', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        const result = await response.json() as {
          account?: Account;
          stateSummary?: AccountStateSummary;
          permissions?: { calendarWrite?: boolean; gmailRead?: boolean };
        };
        setStateSummary(result.stateSummary ?? null);
        setCalendarWriteEnabled(result.permissions?.calendarWrite ?? false);
        setGmailReadEnabled(result.permissions?.gmailRead ?? false);
        return result.account ?? null;
      })
      .then(setAccount)
      .catch(() => setError('Dira could not reach the account service. Try again in a moment.'))
      .finally(() => setLoading(false));
  }, []);

  async function signOut() {
    const response = await fetch('/api/me', { method: 'POST' });
    if (response.ok) setAccount(null);
    else setError('Dira could not sign you out. Try again.');
  }

  async function loadCalendar() {
    setCalendarLoading(true);
    setError('');
    try {
      const response = await fetch('/api/calendar/events', { cache: 'no-store' });
      const result = await response.json() as { events?: CalendarEvent[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Calendar could not be loaded');
      setEvents(result.events ?? []);
    } catch {
      setError('Dira could not read your Google Calendar. Reconnect the account or try again.');
    } finally {
      setCalendarLoading(false);
    }
  }

  async function refreshAccount() {
    const response = await fetch('/api/me', { cache: 'no-store' });
    if (!response.ok) return;
    const result = await response.json() as {
      account?: Account;
      stateSummary?: AccountStateSummary;
      permissions?: { calendarWrite?: boolean; gmailRead?: boolean };
    };
    if (result.account) setAccount(result.account);
    setStateSummary(result.stateSummary ?? null);
    setCalendarWriteEnabled(result.permissions?.calendarWrite ?? false);
    setGmailReadEnabled(result.permissions?.gmailRead ?? false);
    setScheduleRevision((revision) => revision + 1);
  }

  async function importMemory(file: File | undefined) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setError('Choose a memory bundle smaller than 25 MiB.');
      return;
    }
    if (!window.confirm('Restore this backup? It replaces your confirmed graph and focus hours. Pending review proposals will be discarded.')) {
      if (memoryFileInput.current) memoryFileInput.current.value = '';
      return;
    }
    setMemoryImporting(true);
    setError('');
    setMemoryNotice('');
    try {
      const response = await fetch('/api/memory/import', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: file,
      });
      const result = await response.json() as { error?: string; commitmentCount?: number };
      if (!response.ok) throw new Error(result.error ?? 'Memory restore failed.');
      setMemoryNotice(`Memory restored · ${result.commitmentCount ?? 0} commitments`);
      await refreshAccount();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Memory restore failed.');
    } finally {
      setMemoryImporting(false);
      if (memoryFileInput.current) memoryFileInput.current.value = '';
    }
  }

  return (
    <main className="onboarding-wrap">
      <section className="panel onboarding-card" aria-labelledby="onboarding-title">
        <div className="section-label">Personal setup</div>
        <h1 id="onboarding-title" className="hero-title onboarding-title">
          Give Dira a clearer picture of your week.
        </h1>
        <p className="onboarding-copy">
          Connect your Google account to read your calendar and discover your local timezone.
          Dira uses those commitments to find conflicts and propose a repair. This connection
          is read-only; calendar changes will require a separate permission step.
        </p>

        {loading ? (
          <p role="status" className="muted">Checking your account…</p>
        ) : account ? (
          <div className="account-connected">
            <div className="connected-indicator" aria-hidden="true" />
            <div>
              <strong>Google account connected</strong>
              <p>{account.email}</p>
              <p className="muted">Calendar timezone: {account.timezone}</p>
              <p className="muted">
                Calendar changes: {calendarWriteEnabled ? 'permission granted' : 'read-only'}
              </p>
              {!calendarWriteEnabled && (
                <a className="btn btn-secondary" href="/api/auth/google/calendar-write">
                  Enable Calendar changes
                </a>
              )}
              <p className="muted">Gmail: {gmailReadEnabled ? 'read permission granted' : 'not connected'}</p>
              {!gmailReadEnabled && (
                <a className="btn btn-secondary" href="/api/auth/google/gmail-read">
                  Connect Gmail (read-only)
                </a>
              )}
              {stateSummary && (
                <p className="muted">Personal graph: {stateSummary.commitmentCount} commitments · {stateSummary.edgeCount} confirmed links</p>
              )}
              <a className="btn btn-secondary" href="/api/memory/export">Download private memory backup</a>
              <input
                ref={memoryFileInput}
                type="file"
                accept=".bundle,application/octet-stream"
                hidden
                onChange={(event) => void importMemory(event.currentTarget.files?.[0])}
              />
              <button type="button" className="btn btn-secondary" disabled={memoryImporting}
                onClick={() => memoryFileInput.current?.click()}>
                {memoryImporting ? 'Restoring backup…' : 'Restore memory backup'}
              </button>
              {memoryNotice && <p className="muted" role="status">{memoryNotice}</p>}
              {stateSummary?.commitmentCount === 0 && (
                <p className="muted">Calendar events stay outside your graph until you review and confirm them.</p>
              )}
            </div>
            <button type="button" className="btn btn-secondary" onClick={signOut}>Sign out</button>
            <button type="button" className="btn" onClick={loadCalendar} disabled={calendarLoading}>
              {calendarLoading ? 'Loading calendar…' : 'Check calendar connection'}
            </button>
          </div>
        ) : (
          <a className="btn google-connect" href="/api/auth/google/start">
            <GoogleMark />
            Continue with Google
          </a>
        )}
        {events && (
          <section className="calendar-preview" aria-live="polite" aria-label="Upcoming calendar events">
            <h2>Upcoming events</h2>
            {events.length === 0 ? <p className="muted">No upcoming events found.</p> : (
              <ul>
                {events.slice(0, 8).map((event) => (
                  <li key={event.id}>
                    <strong>{event.title}</strong>
                    <time dateTime={event.startIso}>{formatCalendarDate(event.startIso, account?.timezone ?? 'UTC')}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {account && <GraphReview
          timezone={account.timezone}
          commitmentCount={stateSummary?.commitmentCount ?? 0}
          edgeCount={stateSummary?.edgeCount ?? 0}
          onConfirmed={refreshAccount}
        />}
        {account && <ScheduleCheck key={scheduleRevision} />}
        {error && <p className="form-error" role="alert">{error}</p>}
        <p className="privacy-note">
          Dira stores Google credentials encrypted. Calendar write permission is optional and requested only
          when you choose to enable Calendar changes. Signing out ends this device session.
        </p>
      </section>
    </main>
  );
}

function formatCalendarDate(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat('en', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
    }).format(date);
  }
  return new Intl.DateTimeFormat('en', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone,
  }).format(date);
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" width="20" height="20">
      <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z" />
      <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z" />
      <path fill="#FBBC05" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.3H5.8a20 20 0 0 0 0 17.8l6.8-5.3Z" />
      <path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.9-5.9C34.1 5.8 29.5 4 24 4A20 20 0 0 0 5.8 15.1l6.8 5.3C14.2 15.6 18.7 12 24 12Z" />
    </svg>
  );
}

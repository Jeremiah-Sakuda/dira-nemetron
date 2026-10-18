'use client';

import { useEffect, useRef, useState } from 'react';
import { GraphReview } from './graph-review';
import { ScheduleCheck } from './schedule-check';
import { DeadlineFeeds } from './deadline-feeds';
import { MorningSummary } from './morning-summary';

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
  const [section, setSection] = useState<'connections' | 'focus' | 'review'>('connections');
  useEffect(() => {
    const requested = new URL(window.location.href).searchParams.get('section');
    if (requested === 'connections' || requested === 'focus' || requested === 'review') setSection(requested);
  }, []);
  const [account, setAccount] = useState<Account | null>(null);
  const [stateSummary, setStateSummary] = useState<AccountStateSummary | null>(null);
  const [calendarWriteEnabled, setCalendarWriteEnabled] = useState(false);
  const [gmailReadEnabled, setGmailReadEnabled] = useState(false);
  const [gmailComposeEnabled, setGmailComposeEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [memoryImporting, setMemoryImporting] = useState(false);
  const [memoryNotice, setMemoryNotice] = useState('');
  const memoryFileInput = useRef<HTMLInputElement>(null);
  const [scheduleRevision, setScheduleRevision] = useState(0);
  const [graphRevision, setGraphRevision] = useState(0);

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
          permissions?: { calendarWrite?: boolean; gmailRead?: boolean; gmailCompose?: boolean };
        };
        setStateSummary(result.stateSummary ?? null);
        setCalendarWriteEnabled(result.permissions?.calendarWrite ?? false);
        setGmailReadEnabled(result.permissions?.gmailRead ?? false);
        setGmailComposeEnabled(result.permissions?.gmailCompose ?? false);
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
      permissions?: { calendarWrite?: boolean; gmailRead?: boolean; gmailCompose?: boolean };
    };
    if (result.account) setAccount(result.account);
    setStateSummary(result.stateSummary ?? null);
    setCalendarWriteEnabled(result.permissions?.calendarWrite ?? false);
    setGmailReadEnabled(result.permissions?.gmailRead ?? false);
    setGmailComposeEnabled(result.permissions?.gmailCompose ?? false);
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
    <main className="onboarding-wrap workspace-setup">
      <header className="setup-header">
        <div>
          <div className="section-label">Your workspace</div>
          <h1>Connected. On your terms.</h1>
          <p>Choose your tools, make space for focused work, and review what Dira learns.</p>
        </div>
        {account && <a className="btn btn-secondary" href="/today">Go to Today <span aria-hidden="true">↗</span></a>}
      </header>

      {loading ? <section className="panel"><p role="status" className="muted">Checking your account…</p></section>
        : !account ? (
          <section className="panel setup-signin">
            <GoogleMark />
            <h2>Start with your Google account</h2>
            <p>Connect Calendar with read-only access. You choose separately whether Dira can make Calendar changes or create Gmail drafts.</p>
            <a className="btn google-connect" href="/api/auth/google/start">Continue with Google</a>
          </section>
        ) : (
          <>
            <section className="panel setup-account" aria-label="Connected account">
              <div className="setup-account-identity">
                <span className="setup-avatar" aria-hidden="true"><GoogleMark /></span>
                <div><strong>Google account connected</strong><p>{account.email}</p></div>
              </div>
              <div className="setup-account-facts">
                <span>{account.timezone.replaceAll('_', ' ')}</span>
                <span>{stateSummary?.commitmentCount ?? 0} commitments</span>
                <span>{stateSummary?.edgeCount ?? 0} confirmed links</span>
              </div>
              <button type="button" className="btn btn-secondary" onClick={signOut}>Sign out</button>
            </section>

            <div className="setup-tabs" role="tablist" aria-label="Workspace setup">
              {([
                ['connections', 'Connections'], ['focus', 'Focus hours'], ['review', 'Review commitments'],
              ] as const).map(([id, title], index, tabs) => (
                <button key={id} type="button" role="tab" id={`setup-tab-${id}`}
                  aria-controls={`setup-panel-${id}`} aria-selected={section === id} tabIndex={section === id ? 0 : -1}
                  onClick={() => setSection(id)} onKeyDown={(event) => {
                    let next = index;
                    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
                    else if (event.key === 'Home') next = 0;
                    else if (event.key === 'End') next = tabs.length - 1;
                    else return;
                    event.preventDefault(); setSection(tabs[next]![0]);
                    document.getElementById(`setup-tab-${tabs[next]![0]}`)?.focus();
                  }}>
                  {title}
                </button>
              ))}
            </div>

            <section className="setup-section" role="tabpanel" id="setup-panel-connections" aria-labelledby="setup-tab-connections" hidden={section !== 'connections'}>
              <div className="setup-tools">
                <article className="panel setup-tool">
                  <div className="setup-tool-heading"><h2>Google Calendar</h2><span className="setup-connection-state">Connected</span></div>
                  <p>Read your schedule. Turn source changes into commitments you can review.</p>
                  <dl><div><dt>Read access</dt><dd>Permission granted</dd></div><div><dt>Calendar changes</dt><dd>{calendarWriteEnabled ? 'Permission granted' : 'Not enabled'}</dd></div></dl>
                  <div className="setup-tool-actions">
                    {!calendarWriteEnabled && <a className="btn" href="/api/auth/google/calendar-write">Enable Calendar changes</a>}
                    <button type="button" className="btn btn-secondary" onClick={loadCalendar} disabled={calendarLoading}>{calendarLoading ? 'Checking…' : 'Check connection'}</button>
                  </div>
                </article>
                <article className="panel setup-tool">
                  <div className="setup-tool-heading"><h2>Gmail</h2><span className="setup-connection-state">{gmailReadEnabled ? 'Connected' : 'Not connected'}</span></div>
                  <p>Discover commitments in messages and prepare updates for the people involved.</p>
                  <dl><div><dt>Read access</dt><dd>{gmailReadEnabled ? 'Permission granted' : 'Not enabled'}</dd></div><div><dt>Drafting</dt><dd>{gmailComposeEnabled ? 'Permission granted' : 'Not enabled'}</dd></div></dl>
                  <div className="setup-tool-actions">
                    {!gmailReadEnabled && <a className="btn btn-secondary" href="/api/auth/google/gmail-read">Connect read-only</a>}
                    {!gmailComposeEnabled && <a className="btn btn-secondary" href="/api/auth/google/gmail-compose">Enable Gmail drafting</a>}
                    {gmailComposeEnabled && <a className="btn btn-secondary" href="/policies">Manage message policy</a>}
                  </div>
                  {!gmailComposeEnabled && <small>Google grants draft and send access. Dira’s Draft-only setting keeps messages in Drafts until you change that policy.</small>}
                </article>
              </div>
              <p className="setup-privacy-line">Connecting a tool does not enable background processing. <a href="/policies">Choose automatic checks in Settings ↗</a></p>
              {events && <section className="panel calendar-preview" aria-live="polite" aria-label="Upcoming calendar events">
                <h2>Connection checked</h2>
                {events.length === 0 ? <p className="muted">No upcoming events found.</p> : <ul>{events.slice(0, 8).map(event => <li key={event.id}><strong>{event.title}</strong><time dateTime={event.startIso}>{formatCalendarDate(event.startIso, account.timezone)}</time></li>)}</ul>}
              </section>}
              <details className="panel setup-backups setup-feed-disclosure"><summary>Deadline feeds <span>Optional course and task calendars</span></summary><DeadlineFeeds onProposalsChanged={() => setGraphRevision(revision => revision + 1)} /></details>
              <details className="panel setup-backups">
                <summary>Private memory &amp; backups <span>Export or restore your workspace</span></summary>
                <p>Your confirmed graph, focus hours and rules travel with your private memory backup.</p>
                <div className="setup-tool-actions">
                  <a className="btn btn-secondary" href="/api/memory/export">Download backup</a>
                  <input ref={memoryFileInput} type="file" accept=".bundle,application/octet-stream" hidden onChange={event => void importMemory(event.currentTarget.files?.[0])} />
                  <button type="button" className="btn btn-secondary" disabled={memoryImporting} onClick={() => memoryFileInput.current?.click()}>{memoryImporting ? 'Restoring…' : 'Restore backup'}</button>
                </div>
                {memoryNotice && <p role="status">{memoryNotice}</p>}
              </details>
            </section>
            <section className="panel setup-section" role="tabpanel" id="setup-panel-focus" aria-labelledby="setup-tab-focus" hidden={section !== 'focus'}>
              <ScheduleCheck key={scheduleRevision} /><MorningSummary />
            </section>
            <section className="panel setup-section" role="tabpanel" id="setup-panel-review" aria-labelledby="setup-tab-review" hidden={section !== 'review'}>
              <GraphReview timezone={account.timezone} commitmentCount={stateSummary?.commitmentCount ?? 0} edgeCount={stateSummary?.edgeCount ?? 0} revision={graphRevision} onConfirmed={refreshAccount} />
            </section>
          </>
        )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="setup-footer">Credentials are encrypted. Your policy decides what can run. Every external change is read back before Dira marks it verified.</p>
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

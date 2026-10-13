'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlightTimeline, type FlightLine } from './flight-timeline';
import { PlanInbox } from './plan-inbox';
import { formatDay, formatSlack, formatWhen, label, readJson } from '../lib/format';
import { loadSession, startDemo } from '../lib/use-session';

interface Preset { id: string; label: string; description: string; from: string; subject: string; body: string }
interface DemoCommitment {
  id: string; title: string; kind: string; domain: string; flexibility: string; criticality: string; owner: string;
  startIso: string | null; endIso: string | null; deadlineIso: string | null;
}
interface DemoState {
  disclosure: string;
  labels: { calendar: string; mail: string; delegation: string; booking: string; simulated: boolean };
  modelMode: 'live' | 'fixture';
  clockIso: string;
  timezone: string;
  presets: Preset[];
  commitments: DemoCommitment[];
  studyBlocks: number;
  feasibility: { globalSlackMinutes: number; violations: { type: string; detail: string }[] };
}
interface Surfaces {
  calendar: { id: string; title: string; startIso: string; endIso: string }[];
  messages: { id: string; folder: string; to: string; from: string; subject: string; body: string; createdAtIso: string }[];
  bookings: { commitmentId: string; startIso: string; status: string }[];
  delegations: { taskId: string; title: string; owner: string }[];
}
interface RunView {
  id: string; status: string; statusReason?: string; mutationSummary?: string;
  slackBeforeMin?: number; slackAfterMutationMin?: number; slackFinalMin?: number; failuresRecovered: number;
}

export function DemoConsole() {
  const [phase, setPhase] = useState<'loading' | 'needs-session' | 'ready'>('loading');
  const [state, setState] = useState<DemoState | null>(null);
  const [baseline, setBaseline] = useState<Surfaces | null>(null);
  const [surfaces, setSurfaces] = useState<Surfaces | null>(null);
  const [presetId, setPresetId] = useState('professor-move');
  const [draft, setDraft] = useState<{ from: string; subject: string; body: string } | null>(null);
  const [probe, setProbe] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [run, setRun] = useState<RunView | null>(null);
  const [flight, setFlight] = useState<FlightLine[]>([]);
  const [egress, setEgress] = useState<{ status: number; blocked: boolean; target: string; audit: { host: string; verdict: string; statusCode: number; purpose: string; createdAtIso: string }[] } | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/demo/state', { cache: 'no-store' });
    if (response.status === 401 || response.status === 404) {
      setPhase('needs-session');
      if (response.status === 401) await loadSession(true);
      return;
    }
    const body = await readJson<DemoState>(response);
    if (!response.ok) throw new Error(body.error ?? 'The demo could not be loaded.');
    setState(body);
    const surfaceResponse = await fetch('/api/surfaces', { cache: 'no-store' });
    const surfaceBody = await readJson<Surfaces>(surfaceResponse);
    if (surfaceResponse.ok) {
      setSurfaces(surfaceBody);
      setBaseline((current) => current ?? surfaceBody);
    }
    setPhase('ready');
  }, []);

  useEffect(() => { void refresh().catch((cause) => setError(String(cause instanceof Error ? cause.message : cause))); }, [refresh]);

  const preset = state?.presets.find((item) => item.id === presetId);
  const email = draft ?? (preset ? { from: preset.from, subject: preset.subject, body: preset.body } : null);
  const edited = Boolean(draft && preset && (draft.body !== preset.body || draft.from !== preset.from));

  async function begin() {
    setBusy('start'); setError('');
    try {
      await startDemo();
      setBaseline(null); setRun(null); setFlight([]); setEgress(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(''); }
  }

  async function reset() {
    setBusy('reset'); setError('');
    try {
      const response = await fetch('/api/demo/reset', { method: 'POST' });
      if (response.status === 401) { setPhase('needs-session'); await loadSession(true); return; }
      if (!response.ok) throw new Error((await readJson(response)).error ?? 'Reset failed.');
      await loadSession(true);
      setBaseline(null); setRun(null); setFlight([]); setEgress(null); setDraft(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(''); }
  }

  async function send() {
    if (!email) return;
    setBusy('send'); setError(''); setEgress(null);
    try {
      const response = await fetch('/api/demo/trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ presetId, ...(edited ? email : {}), adversarialProbe: probe }),
      });
      const body = await readJson<{ run: RunView; flight: FlightLine[] }>(response);
      if (response.status === 401) { setPhase('needs-session'); await loadSession(true); return; }
      if (!response.ok) throw new Error(body.error ?? 'Dira could not process that email.');
      setRun(body.run);
      setFlight(body.flight);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(''); }
  }

  const reloadRun = useCallback(async () => {
    if (!run) return;
    const response = await fetch(`/api/workflows/${encodeURIComponent(run.id)}`, { cache: 'no-store' });
    const body = await readJson<{ run: RunView; flight: FlightLine[] }>(response);
    if (response.ok) { setRun(body.run); setFlight(body.flight); }
    await refresh();
  }, [run, refresh]);

  async function tryEgress() {
    setBusy('egress'); setError('');
    try {
      const response = await fetch('/api/demo/egress-probe', { method: 'POST' });
      const body = await readJson<NonNullable<typeof egress>>(response);
      if (!response.ok) throw new Error(body.error ?? 'Probe failed.');
      setEgress(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(''); }
  }

  const days = useMemo(() => groupByDay(state), [state]);

  if (phase === 'loading') return <main><p className="muted" role="status">Loading the demo…</p></main>;
  if (phase === 'needs-session') {
    return (
      <main className="demo-start">
        <div className="panel demo-start-card">
          <div className="section-label">Try Dira · no sign-in</div>
          <h1 className="hero-title">A synthetic student week, all yours for four hours.</h1>
          <p>Dira creates a private demo account with a pre-built commitment graph, its own simulated calendar,
            mailbox and counterparty slots. Nothing you do here can reach a real person.</p>
          <button className="btn" type="button" onClick={() => void begin()} disabled={busy === 'start'}>
            {busy === 'start' ? 'Creating your demo…' : 'Start the demo'}
          </button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      </main>
    );
  }
  if (!state) return null;

  const slack = state.feasibility.globalSlackMinutes;
  const changed = baseline && surfaces ? diffCalendar(baseline, surfaces) : [];
  const outbound = surfaces?.messages.filter((message) => message.folder !== 'INBOX') ?? [];

  return (
    <main className="demo-console">
      <header className="demo-header">
        <div>
          <div className="section-label">Demo · Sam Adeyemi, junior · {state.timezone}</div>
          <h1 className="page-title">One email moves the midterm. Watch what breaks, and what Dira does about it.</h1>
          <p className="page-sub">{state.disclosure} Simulated clock: {formatDay(state.clockIso, state.timezone)}, {formatWhen(state.clockIso, state.timezone).split(' ').slice(1).join(' ')}.</p>
        </div>
        <div className="demo-header-actions">
          <span className={`status-pill${state.modelMode === 'live' ? ' pill-good' : ''}`}>
            {state.modelMode === 'live' ? 'Nemotron live · Nebius Token Factory' : 'Stored interpretations · no inference'}
          </span>
          <button className="btn btn-secondary" type="button" onClick={() => void reset()} disabled={busy === 'reset'}>
            {busy === 'reset' ? 'Resetting…' : 'Reset demo'}
          </button>
        </div>
      </header>
      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="demo-grid">
        <section className="panel demo-week" aria-labelledby="week-title">
          <div className="demo-week-heading">
            <h2 id="week-title">The week</h2>
            <span className={`slack-badge ${slack < 0 ? 'negative' : 'positive'}`} title="Global slack: the smallest margin across every deadline and buffer">
              Global slack {formatSlack(slack)}
            </span>
          </div>
          {state.feasibility.violations.length > 0 && (
            <ul className="violation-list">
              {state.feasibility.violations.map((violation, index) => (
                <li key={`${violation.type}-${index}`}><strong>{label(violation.type)}</strong> {violation.detail}</li>
              ))}
            </ul>
          )}
          {days.map(([day, items]) => (
            <div className="week-day" key={day}>
              <h3>{day}</h3>
              {items.map((item) => (
                <div className="week-item" key={item.id} data-domain={item.domain}>
                  <span className="week-time">{item.startIso ? formatWhen(item.startIso, state.timezone).split(' ').slice(1).join(' ') : `due ${formatWhen(item.deadlineIso, state.timezone).split(' ').slice(1).join(' ')}`}</span>
                  <span className="week-title">{item.title}</span>
                  <span className="week-meta">{label(item.flexibility)}{item.owner !== 'You' ? ` · ${item.owner}` : ''}</span>
                </div>
              ))}
            </div>
          ))}
          <p className="footnote">Plus {state.studyBlocks} study reservations for the midterm. Effort tasks show their deadline.</p>
        </section>

        <section className="panel demo-trigger" aria-labelledby="trigger-title">
          <h2 id="trigger-title">Send Dira an email</h2>
          <div className="preset-tabs" role="tablist" aria-label="Sample emails">
            {state.presets.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={presetId === item.id}
                className={presetId === item.id ? 'preset-tab active' : 'preset-tab'}
                onClick={() => { setPresetId(item.id); setDraft(null); }}>
                {item.label}
              </button>
            ))}
          </div>
          {preset && <p className="muted">{preset.description}</p>}
          {email && (
            <div className="email-composer">
              <label>From<input value={email.from} disabled={state.modelMode !== 'live'}
                onChange={(event) => setDraft({ ...email, from: event.target.value })} /></label>
              <label>Subject<input value={email.subject} disabled={state.modelMode !== 'live'}
                onChange={(event) => setDraft({ ...email, subject: event.target.value })} /></label>
              <label>Body<textarea rows={6} value={email.body} disabled={state.modelMode !== 'live'}
                onChange={(event) => setDraft({ ...email, body: event.target.value })} /></label>
              {state.modelMode !== 'live' && <p className="footnote">This deployment has no Nebius key, so the sample emails run on stored interpretations and cannot be edited. Every other step is the real engine.</p>}
            </div>
          )}
          <label className="checkbox-row">
            <input type="checkbox" checked={probe} onChange={(event) => setProbe(event.target.checked)} />
            Also inject a labeled adversarial plan (cites a message that does not exist, mails an outside address)
          </label>
          <button className="btn" type="button" onClick={() => void send()} disabled={busy === 'send' || !email}>
            {busy === 'send' ? 'Dira is working…' : 'Deliver this email to Dira'}
          </button>
        </section>
      </div>

      {run && (
        <section className="panel demo-run" aria-live="polite" aria-labelledby="run-title">
          <div className="run-summary">
            <div>
              <div className="section-label">Workflow {run.id.slice(-12)}</div>
              <h2 id="run-title">{run.mutationSummary ?? 'Email processed'}</h2>
              {run.statusReason && <p className="muted">{run.statusReason}</p>}
            </div>
            <span className={`status-pill run-${run.status.toLowerCase()}`}>{label(run.status)}</span>
          </div>
          {run.slackBeforeMin !== undefined && (
            <div className="slack-track" aria-label="Global slack through the run">
              <SlackStep label="Before" value={run.slackBeforeMin} />
              <SlackStep label="After the email" value={run.slackAfterMutationMin} />
              <SlackStep label="After repair" value={run.slackFinalMin} pending={run.status !== 'RESOLVED'} />
            </div>
          )}
          {run.status === 'AWAITING_APPROVAL' && (
            <div className="demo-approval">
              <h3>Policy paused one action for you</h3>
              <p className="muted">The demo policy requires approval before Dira hands work to someone else. This is the same inbox signed-in users see at <Link href="/approvals">Approvals</Link>; on a phone the same decision arrives as a Telegram button.</p>
              <PlanInbox compact workflowId={run.id} onChanged={reloadRun} />
            </div>
          )}
          <details className="flight-details" open>
            <summary>Flight record · {flight.length} lines</summary>
            <FlightTimeline lines={flight} />
          </details>
        </section>
      )}

      {surfaces && (changed.length > 0 || outbound.length > 0 || surfaces.bookings.length > 0) && (
        <section className="panel demo-verify" aria-labelledby="verify-title">
          <h2 id="verify-title">What actually changed</h2>
          <p className="muted">Fresh reads of each simulated surface, compared with the start of the session. Dira marks an action verified only after a read like this.</p>
          <div className="verify-grid">
            <div>
              <h3>{state.labels.calendar}</h3>
              {changed.length === 0 ? <p className="muted">No calendar changes.</p> : (
                <ul className="change-list">{changed.map((item) => (
                  <li key={item.id}><strong>{item.title}</strong>
                    <span>{item.before ? formatWhen(item.before, state.timezone) : 'new'} → {item.after ? formatWhen(item.after, state.timezone) : 'removed'}</span></li>
                ))}</ul>
              )}
            </div>
            <div>
              <h3>{state.labels.mail} · Sent</h3>
              {outbound.length === 0 ? <p className="muted">Nothing sent.</p> : outbound.map((message) => (
                <article className="mail-card" key={message.id}>
                  <div className="mail-meta">{label(message.folder)} · to {message.to}</div>
                  <strong>{message.subject}</strong>
                  <p>{message.body}</p>
                </article>
              ))}
            </div>
            <div>
              <h3>Bookings and owners</h3>
              {surfaces.bookings.map((booking) => (
                <p key={booking.commitmentId}><strong>Interview</strong> {formatWhen(booking.startIso, state.timezone)} · {label(booking.status)}</p>
              ))}
              {surfaces.delegations.map((task) => (
                <p key={task.taskId}><strong>{task.title}</strong> owner: {task.owner === 'maya-okafor' ? 'Maya Okafor' : task.owner.startsWith('demo-') ? 'You' : task.owner}</p>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="panel demo-egress" aria-labelledby="egress-title">
        <h2 id="egress-title">The sandbox boundary</h2>
        <p className="muted">The prompt-injection email asks Dira to upload your inbox to outside-collector.example. This demo verifies the broker&rsquo;s application-level allowlist and audited HTTP 403. OpenShell/NemoClaw is not enabled on this deployment, so network-edge sandbox enforcement is not active here.</p>
        <button className="btn btn-secondary" type="button" onClick={() => void tryEgress()} disabled={busy === 'egress'}>
          {busy === 'egress' ? 'Trying…' : 'Have Dira try to reach that host'}
        </button>
        {egress && (
          <div className={egress.blocked ? 'egress-result blocked' : 'egress-result'} role="status">
            <strong>{egress.blocked ? `Blocked · HTTP ${egress.status}` : `Not blocked (HTTP ${egress.status})`}</strong> {egress.target}
            <ul>{egress.audit.slice(0, 3).map((entry) => (
              <li key={entry.createdAtIso}>{new Date(entry.createdAtIso).toLocaleTimeString()} · {entry.verdict} {entry.host} → {entry.statusCode} · {entry.purpose}</li>
            ))}</ul>
          </div>
        )}
      </section>

      <p className="footnote">Next: open <Link href="/rules">Rules</Link> after correcting an action in the inbox, or <Link href="/activity">Activity</Link> for every run&rsquo;s flight record. Engine replays live on the <Link href="/evidence">Evidence</Link> page.</p>
    </main>
  );
}

function SlackStep({ label: text, value, pending }: { label: string; value?: number; pending?: boolean }) {
  return (
    <div className="slack-step">
      <span>{text}</span>
      <strong className={value === undefined ? '' : value < 0 ? 'negative' : 'positive'}>{pending && value === undefined ? '…' : formatSlack(value)}</strong>
    </div>
  );
}

function groupByDay(state: DemoState | null): [string, DemoCommitment[]][] {
  if (!state) return [];
  const map = new Map<string, DemoCommitment[]>();
  const sorted = [...state.commitments].sort((a, b) => Date.parse(a.startIso ?? a.deadlineIso ?? '') - Date.parse(b.startIso ?? b.deadlineIso ?? ''));
  for (const item of sorted) {
    const when = item.startIso ?? item.deadlineIso;
    if (!when) continue;
    const day = formatDay(when, state.timezone);
    map.set(day, [...(map.get(day) ?? []), item]);
  }
  return [...map.entries()];
}

function diffCalendar(before: Surfaces, after: Surfaces) {
  const changes: { id: string; title: string; before?: string; after?: string }[] = [];
  const old = new Map(before.calendar.map((event) => [event.id, event]));
  const next = new Map(after.calendar.map((event) => [event.id, event]));
  for (const [id, event] of next) {
    const prior = old.get(id);
    if (!prior) changes.push({ id, title: event.title, after: event.startIso });
    else if (Date.parse(prior.startIso) !== Date.parse(event.startIso)) changes.push({ id, title: event.title, before: prior.startIso, after: event.startIso });
  }
  for (const [id, event] of old) if (!next.has(id)) changes.push({ id, title: event.title, before: event.startIso });
  return changes;
}

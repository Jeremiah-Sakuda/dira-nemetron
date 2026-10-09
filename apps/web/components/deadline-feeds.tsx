'use client';

import { useEffect, useState } from 'react';

type FeedDomain = 'academic' | 'career';
interface Feed {
  feedId: string;
  label: string;
  domain: FeedDomain;
  enabled: boolean;
  autoSync: boolean;
  eventCount: number;
  lastCheckedAtIso?: string;
  lastError?: string;
}

export function DeadlineFeeds({ onProposalsChanged }: { onProposalsChanged: () => void }) {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [domain, setDomain] = useState<FeedDomain>('academic');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadFeeds() {
    const response = await fetch('/api/ical/feeds', { cache: 'no-store' });
    const result = await response.json() as { feeds?: Feed[]; error?: string };
    if (!response.ok) throw new Error(result.error ?? 'Deadline feeds could not be loaded.');
    setFeeds(result.feeds ?? []);
  }

  useEffect(() => {
    loadFeeds()
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Deadline feeds could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  async function addFeed(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/ical/feeds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label, url, domain }),
      });
      const result = await response.json() as { feeds?: Feed[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'This feed could not be saved.');
      setFeeds(result.feeds ?? []);
      setLabel('');
      setUrl('');
      setNotice('Feed saved. Review its events before they enter your graph.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This feed could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function updateFeed(feed: Feed, patch: Partial<Pick<Feed, 'label' | 'domain' | 'enabled' | 'autoSync'>>) {
    setBusyId(feed.feedId);
    setError('');
    try {
      const response = await fetch(`/api/ical/feeds/${encodeURIComponent(feed.feedId)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: feed.label, domain: feed.domain, enabled: feed.enabled, autoSync: feed.autoSync, ...patch }),
      });
      const result = await response.json() as { feeds?: Feed[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Feed settings could not be saved.');
      setFeeds(result.feeds ?? []);
      setNotice(patch.enabled === false ? 'Feed disabled. Dira will stop reading it.' : 'Feed settings saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Feed settings could not be saved.');
    } finally {
      setBusyId('');
    }
  }

  async function syncFeed(feed: Feed) {
    setBusyId(feed.feedId);
    setError('');
    setNotice(`Checking ${feed.label}…`);
    try {
      const response = await fetch(`/api/ical/feeds/${encodeURIComponent(feed.feedId)}/sync`, { method: 'POST' });
      const result = await response.json() as {
        feeds?: Feed[]; proposalsCreated?: number; updated?: number; cancelled?: number;
        ignored?: number; partial?: boolean; notModified?: boolean; error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? 'The feed could not be synced.');
      setFeeds(result.feeds ?? []);
      onProposalsChanged();
      setNotice(result.notModified
        ? `${feed.label} has no changes.`
        : `${feed.label}: ${result.proposalsCreated ?? 0} new proposal(s), ${result.updated ?? 0} update(s), ${result.cancelled ?? 0} cancellation(s), ${result.ignored ?? 0} skipped item(s)${result.partial ? ' · more items will be picked up on the next check' : ''}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The feed could not be synced.');
      setNotice('');
      await loadFeeds().catch(() => undefined);
    } finally {
      setBusyId('');
    }
  }

  async function removeFeed(feed: Feed) {
    setBusyId(feed.feedId);
    setError('');
    try {
      const response = await fetch(`/api/ical/feeds/${encodeURIComponent(feed.feedId)}`, { method: 'DELETE' });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Feed could not be removed.');
      setFeeds((current) => current.filter((item) => item.feedId !== feed.feedId));
      setNotice(`${feed.label} was removed. Confirmed commitments remain in your graph.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Feed could not be removed.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="panel deadline-feeds" aria-labelledby="deadline-feeds-title" aria-busy={loading || saving}>
      <div className="section-label">User-selected sources</div>
      <h2 id="deadline-feeds-title">Deadline feeds</h2>
      <p className="muted">Connect an HTTPS iCalendar export from an LMS or task tracker. Dira stores the feed URL encrypted, fetches only public HTTPS hosts, and proposes events for review. Recurring event rules are not expanded yet.</p>
      <p className="privacy-note">Event titles and dates are sent to Nebius Token Factory for structured draft extraction. Feed descriptions and locations are ignored. Nothing enters your graph until you confirm it.</p>
      <form className="deadline-feed-form" onSubmit={addFeed}>
        <label>Feed name<input value={label} maxLength={120} required onChange={(event) => setLabel(event.currentTarget.value)} placeholder="BIO 201 assignments" /></label>
        <label>Area<select value={domain} onChange={(event) => setDomain(event.currentTarget.value as FeedDomain)}><option value="academic">Academic</option><option value="career">Career</option></select></label>
        <label className="deadline-feed-url">iCalendar URL<input type="url" value={url} maxLength={4096} required onChange={(event) => setUrl(event.currentTarget.value)} placeholder="https://…/calendar.ics" /></label>
        <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add feed'}</button>
      </form>
      {loading ? <p role="status" className="muted">Loading your feeds…</p> : feeds.length === 0
        ? <p className="muted">No deadline feeds connected.</p>
        : <ul className="deadline-feed-list">
          {feeds.map((feed) => (
            <li key={feed.feedId} className="deadline-feed-card">
              <div className="deadline-feed-heading">
                <div><strong>{feed.label}</strong><span className="muted">{feed.domain} · {feed.eventCount} saved event(s)</span></div>
                {feed.lastCheckedAtIso && <time dateTime={feed.lastCheckedAtIso}>Checked {new Date(feed.lastCheckedAtIso).toLocaleString()}</time>}
              </div>
              {feed.lastError && <p className="form-error" role="status">{feed.lastError}</p>}
              <div className="deadline-feed-controls">
                <label><input type="checkbox" checked={feed.enabled} disabled={busyId === feed.feedId}
                  onChange={(event) => {
                    const enabled = event.currentTarget.checked;
                    void updateFeed(feed, { enabled, ...(!enabled ? { autoSync: false } : {}) });
                  }} /> Read this feed</label>
                <label><input type="checkbox" checked={feed.autoSync} disabled={!feed.enabled || busyId === feed.feedId}
                  onChange={(event) => void updateFeed(feed, { autoSync: event.currentTarget.checked })} /> Check every 30 minutes</label>
                <button className="btn btn-secondary" type="button" disabled={!feed.enabled || busyId === feed.feedId} onClick={() => void syncFeed(feed)}>
                  {busyId === feed.feedId ? 'Working…' : 'Sync now'}
                </button>
                <button className="btn btn-secondary" type="button" disabled={busyId === feed.feedId} onClick={() => void removeFeed(feed)}>Remove</button>
              </div>
            </li>
          ))}
        </ul>}
      {notice && <p className="policy-feedback" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}

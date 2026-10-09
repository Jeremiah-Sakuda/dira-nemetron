import { minutesToIso, type Commitment } from '@dira/commitment-model';
import { CalendarGraphBuilder } from '@dira/agent';
import { parseIcalFeed, type IcalEvent } from '@dira/adapter-calendar/ical-feed';
import { fetchIcalFeed, IcalFetchError, normalizeIcalUrl } from '@dira/adapter-calendar/safe-ical-fetch';
import { createHash, randomUUID } from 'node:crypto';
import { decryptAccountSecret, encryptAccountSecret } from './google-auth.js';
import type { IcalEventSnapshot, PostgresAccountStore, StoredIcalFeed } from './postgres-store.js';

const MAX_PROPOSALS_PER_SYNC = 25;
const PROPOSAL_HORIZON_DAYS = 180;

export interface IcalSyncSummary {
  scanned: number;
  proposalsCreated: number;
  updated: number;
  cancelled: number;
  ignored: number;
  skipped: number;
  partial: boolean;
  notModified?: boolean;
  syncedAtIso: string;
  busy?: boolean;
}

export async function createIcalFeed(
  store: PostgresAccountStore,
  accountId: string,
  input: { label: string; domain: 'academic' | 'career'; url: string },
): Promise<string> {
  const label = input.label.trim().slice(0, 120);
  if (!label) throw new Error('Feed name is required.');
  const url = normalizeIcalUrl(input.url).toString();
  const feedId = randomUUID();
  await store.createIcalFeed(accountId, {
    feedId, label, domain: input.domain, urlSecret: encryptAccountSecret(url),
  });
  return feedId;
}

export async function syncAccountIcalFeed(
  store: PostgresAccountStore,
  accountId: string,
  feedId: string,
): Promise<IcalSyncSummary> {
  const locked = await store.withAdvisoryJobLock(accountId, `ical-feed:${feedId}`, () =>
    performIcalSync(store, accountId, feedId));
  if (locked.acquired) return locked.value;
  return { scanned: 0, proposalsCreated: 0, updated: 0, cancelled: 0, ignored: 0,
    skipped: 0, partial: false, syncedAtIso: new Date().toISOString(), busy: true };
}

async function performIcalSync(
  store: PostgresAccountStore,
  accountId: string,
  feedId: string,
): Promise<IcalSyncSummary> {
  const feed = await store.getIcalFeed(accountId, feedId);
  if (!feed || !feed.enabled || !feed.urlSecret) throw new Error('This deadline feed is disabled or unavailable.');
  const rawUrl = decryptAccountSecret<string>(feed.urlSecret);
  let remote;
  try {
    remote = await fetchIcalFeed(rawUrl, { etag: feed.etag, lastModified: feed.lastModified });
  } catch (error) {
    const reason = safeFeedFailure(error);
    await store.recordIcalFeedFailure(accountId, feedId, reason);
    throw new Error(reason);
  }
  if (remote.notModified) {
    await store.saveIcalFeedSync(accountId, feedId, {
      snapshot: feed.snapshot, etag: remote.etag, lastModified: remote.lastModified,
    });
    return { scanned: 0, proposalsCreated: 0, updated: 0, cancelled: 0,
      ignored: 0, skipped: 0, partial: false, notModified: true, syncedAtIso: new Date().toISOString() };
  }

  const accountState = await store.ensureDomainState(accountId);
  let parsed;
  try {
    parsed = parseIcalFeed(remote.body, accountState.timezone ?? 'UTC');
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The source is not a supported iCalendar feed.';
    await store.recordIcalFeedFailure(accountId, feedId, reason);
    throw new Error(reason);
  }

  const [savedProposals, accountFeeds] = await Promise.all([
    store.listGraphProposals(accountId),
    store.listIcalFeeds(accountId),
  ]);
  const currentFeed = accountFeeds.find((item) => item.feedId === feedId);
  if (!currentFeed?.enabled) throw new Error('This deadline feed was disabled during sync.');
  const feedLabel = currentFeed.label;
  const feedDomain = currentFeed.domain;
  const proposalBySource = new Map(savedProposals.map((proposal) => [proposal.sourceId, proposal]));
  const externalPrefix = `${feedId}:`;
  const commitments = Object.values(accountState.commitments).filter(
    (item) => item.externalSystem === 'ical-feed' && item.externalId?.startsWith(externalPrefix),
  );
  const commitmentsByUid = new Map(commitments.map((item) => [item.externalId!.slice(externalPrefix.length), item]));
  const now = Date.now();
  const horizonEnd = now + PROPOSAL_HORIZON_DAYS * 24 * 60 * 60_000;
  const changes: { event: IcalEvent; commitment?: Commitment }[] = [];

  for (const event of Object.values(parsed.events)) {
    const commitment = commitmentsByUid.get(event.uid);
    const prior = feed.snapshot[event.uid];
    const saved = proposalBySource.get(`ical:${feedId}:${event.uid}`);
    if (prior?.version === event.version || saved?.source.version === event.version) continue;
    if (commitment && ['COMPLETE', 'DROPPED'].includes(commitment.status)) continue;
    const startMs = Date.parse(event.startIso);
    if (!commitment && (!Number.isFinite(startMs) || startMs < now || startMs >= horizonEnd)) continue;
    changes.push({ event, commitment });
  }

  const freshEventIds = new Set(Object.keys(parsed.events));
  const cancelledUids = new Set([
    ...parsed.cancelledUids,
    ...Object.keys(feed.snapshot).filter((uid) => !freshEventIds.has(uid)),
  ]);
  let proposalsCreated = 0;
  let updated = 0;
  let cancelled = 0;
  let ignored = parsed.skipped;
  const builder = new CalendarGraphBuilder();
  const processedUids = new Set<string>();

  for (const { event, commitment } of changes.slice(0, MAX_PROPOSALS_PER_SYNC)) {
    const sourceId = `ical:${feedId}:${event.uid}`;
    const previous = commitment ? commitmentSnapshot(commitment, accountState.horizonStartIso, accountState.timezone ?? 'UTC') : undefined;
    const source = {
      id: sourceId,
      title: event.title,
      startIso: event.startIso,
      endIso: event.endIso,
      version: event.version,
      changeType: commitment ? 'UPDATED' as const : 'NEW' as const,
      feedId,
      feedUid: event.uid,
      feedLabel,
      ...(previous ? { previous } : {}),
    };
    if (commitment) {
      const result = await store.saveGraphProposal(accountId, {
        sourceType: 'ical-feed',
        source,
        draft: draftFromCommitment(commitment, 'This deadline-feed event changed. Review the updated source details before changing its graph commitment.'),
        model: { provider: 'ical-source-sync', generatedAtIso: new Date().toISOString() },
      });
      if (result) { proposalsCreated += 1; updated += 1; }
    } else {
      const result = await builder.propose(source);
      // The user chose the source domain during feed setup; model classification
      // must not silently reclassify a whole feed.
      const draft = { ...result.draft, domain: feedDomain };
      const saved = await store.saveGraphProposal(accountId, {
        sourceType: 'ical-feed',
        source: { ...result.source, feedId, feedUid: event.uid, feedLabel },
        draft,
        model: result.model,
      }, draft.include ? 'PENDING_REVIEW' : 'IGNORED');
      if (saved) {
        if (draft.include) proposalsCreated += 1;
        else ignored += 1;
      }
    }
    processedUids.add(event.uid);
  }

  for (const uid of cancelledUids) {
    const commitment = commitmentsByUid.get(uid);
    const sourceId = `ical:${feedId}:${uid}`;
    const saved = proposalBySource.get(sourceId);
    if (commitment && !['COMPLETE', 'DROPPED'].includes(commitment.status)) {
      const missingVersion = `missing:${snapshotVersion(parsed.events)}`;
      if (saved?.source.version !== missingVersion || saved.status !== 'PENDING_REVIEW') {
        const previous = commitmentSnapshot(commitment, accountState.horizonStartIso, accountState.timezone ?? 'UTC');
        const result = await store.saveGraphProposal(accountId, {
          sourceType: 'ical-feed',
          source: { id: sourceId, ...previous, version: missingVersion, changeType: 'CANCELLED', feedId, feedUid: uid, feedLabel, previous },
          draft: draftFromCommitment(commitment, 'This event is no longer present in the deadline feed. Confirm whether its commitment should be removed.'),
          model: { provider: 'ical-source-sync', generatedAtIso: new Date().toISOString() },
        });
        if (result) { proposalsCreated += 1; cancelled += 1; }
      }
    } else if (saved?.status === 'PENDING_REVIEW') {
      const previous = saved.source;
      const result = await store.saveGraphProposal(accountId, {
        sourceType: 'ical-feed',
        source: { ...previous, version: `missing:${snapshotVersion(parsed.events)}`, changeType: 'CANCELLED' },
        draft: saved.draft,
        model: saved.model,
      }, 'IGNORED');
      if (result) ignored += 1;
    }
  }

  const remaining = changes.some(({ event }) => !processedUids.has(event.uid));
  if (!remaining) {
    const storedSnapshot: Record<string, IcalEventSnapshot> = Object.fromEntries(
      Object.entries(parsed.events).map(([uid, event]) => [uid, { ...event }]),
    );
    await store.saveIcalFeedSync(accountId, feedId, {
      snapshot: storedSnapshot, etag: remote.etag, lastModified: remote.lastModified,
    });
  }
  return {
    scanned: Object.keys(parsed.events).length,
    proposalsCreated,
    updated,
    cancelled,
    ignored,
    skipped: parsed.skipped,
    partial: remaining,
    syncedAtIso: new Date().toISOString(),
  };
}

export function startConfiguredIcalPolling(getStore: () => Promise<PostgresAccountStore>): NodeJS.Timeout | undefined {
  const accountIds = [...new Set((process.env.DIRA_ICAL_SYNC_ACCOUNT_IDS ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean))];
  if (!accountIds.length) return undefined;
  const configuredInterval = Number(process.env.DIRA_ICAL_POLL_INTERVAL_MS ?? 30 * 60_000);
  const intervalMs = Number.isFinite(configuredInterval) && configuredInterval >= 5 * 60_000
    ? Math.min(configuredInterval, 6 * 60 * 60_000)
    : 30 * 60_000;
  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      const store = await getStore();
      for (const accountId of accountIds) {
        try {
          const feeds = await store.listIcalFeeds(accountId);
          for (const feed of feeds) {
            if (!feed.enabled || !feed.autoSync) continue;
            try {
              const summary = await syncAccountIcalFeed(store, accountId, feed.feedId);
              if (!summary.busy && summary.scanned > 0) {
                console.info(JSON.stringify({ severity: 'INFO', msg: 'iCalendar feed sync completed',
                  feedId: feed.feedId, scanned: summary.scanned, proposals: summary.proposalsCreated,
                  partial: summary.partial }));
              }
            } catch (error) {
              console.error(JSON.stringify({ severity: 'WARN', msg: 'iCalendar feed sync failed',
                feedId: feed.feedId, failure: error instanceof Error ? error.message : String(error) }));
            }
          }
        } catch (error) {
          console.error(JSON.stringify({ severity: 'WARN', msg: 'iCalendar account polling failed',
            failure: error instanceof Error ? error.message : String(error) }));
        }
      }
    } catch (error) {
      console.error(JSON.stringify({ severity: 'ERROR', msg: 'iCalendar poller could not access account storage',
        failure: error instanceof Error ? error.message : String(error) }));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void poll(), intervalMs);
  timer.unref();
  void poll();
  return timer;
}

function safeFeedFailure(error: unknown): string {
  if (error instanceof IcalFetchError) return error.message;
  return 'The iCalendar feed could not be downloaded safely.';
}

function snapshotVersion(events: Record<string, IcalEvent>): string {
  const input = Object.entries(events).sort(([a], [b]) => a.localeCompare(b))
    .map(([uid, event]) => `${uid}:${event.version}`).join('\n');
  return createHash('sha256').update(input).digest('hex');
}

function commitmentSnapshot(commitment: Commitment, horizonStartIso: string, timezone: string) {
  if (commitment.kind === 'effort' && commitment.deadlineMin !== undefined) {
    const deadline = minutesToIso(commitment.deadlineMin, horizonStartIso, timezone);
    return { title: commitment.title, startIso: deadline, endIso: deadline };
  }
  const startIso = commitment.startMin === undefined
    ? horizonStartIso
    : minutesToIso(commitment.startMin, horizonStartIso, timezone);
  const endIso = commitment.startMin === undefined || commitment.durationMin === undefined
    ? startIso
    : minutesToIso(commitment.startMin + commitment.durationMin, horizonStartIso, timezone);
  return { title: commitment.title, startIso, endIso };
}

function draftFromCommitment(commitment: Commitment, reason: string) {
  return {
    include: true as const,
    title: commitment.title,
    domain: commitment.domain,
    kind: commitment.kind,
    flexibility: commitment.flexibility === 'DELEGATABLE' ? 'FIXED' as const : commitment.flexibility,
    criticality: commitment.criticality,
    estimatedEffortMin: commitment.requiredEffortMin ?? null,
    confidence: commitment.confidence,
    reason,
  };
}

import { minutesToIso, type Commitment } from '@dira/commitment-model';
import { GoogleUserCalendarTool } from '@dira/adapter-calendar/user-google';
import { CalendarGraphBuilder } from '@dira/agent';
import type { PostgresAccountStore } from './postgres-store.js';

const CALENDAR_READ_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

export interface CalendarSyncSummary {
  changes: number;
  proposals: number;
  updated: number;
  cancelled: number;
  excluded: number;
  reset: boolean;
  syncedAtIso: string;
  busy?: boolean;
}

/**
 * Read one durable Calendar delta, turn source changes into review proposals,
 * then advance the cursor. If any model or database write fails, the old
 * cursor remains so the same delta is retried safely on the next poll.
 */
export async function syncAccountCalendarChanges(
  store: PostgresAccountStore,
  accountId: string,
  getAccessToken: () => Promise<string>,
): Promise<CalendarSyncSummary> {
  const locked = await store.withAdvisoryJobLock(accountId, 'google-calendar-sync', () =>
    performAccountCalendarSync(store, accountId, getAccessToken));
  if (locked.acquired) return locked.value;
  return {
    changes: 0, proposals: 0, updated: 0, cancelled: 0, excluded: 0,
    reset: false, syncedAtIso: new Date().toISOString(), busy: true,
  };
}

async function performAccountCalendarSync(
  store: PostgresAccountStore,
  accountId: string,
  getAccessToken: () => Promise<string>,
): Promise<CalendarSyncSummary> {
  const policy = await store.getAccountPolicySettings(accountId);
  if (policy.fencedCalendarIds.includes('primary')) {
    const reason = 'Primary Google Calendar is fenced by account policy.';
    await store.recordPolicyBlock(accountId, {
      actionType: 'SYNC_CALENDAR', targetId: 'primary', policyRule: 'fenced-calendar', reason,
    });
    throw new Error(reason);
  }
  const credential = await store.getCredential(accountId, 'google');
  if (!credential?.scopes.includes(CALENDAR_READ_SCOPE)) {
    throw new Error('Grant Google Calendar read access before syncing its changes.');
  }

  const priorToken = await store.getSourceSyncCursor(accountId, 'google-calendar');
  const calendar = new GoogleUserCalendarTool(
    getAccessToken,
    undefined,
    async () => (await store.getAccountPolicySettings(accountId)).fencedCalendarIds.includes('primary'),
  );
  const delta = await calendar.syncEvents(priorToken);
  const state = await store.ensureDomainState(accountId);
  const savedProposals = await store.listGraphProposals(accountId);
  const proposalsBySource = new Map(savedProposals.map((proposal) => [proposal.sourceId, proposal]));
  const commitmentsByExternalId = new Map(
    Object.values(state.commitments)
      .filter((commitment) => commitment.externalSystem === 'calendar' && commitment.externalId)
      .map((commitment) => [commitment.externalId!, commitment]),
  );
  const fullSyncEventIds = new Set(delta.changes.filter((change) => !change.deleted).map((change) => change.eventId));
  let proposals = 0;
  let updated = 0;
  let cancelled = 0;
  let excluded = 0;
  const now = Date.now();
  const horizonEnd = now + 90 * 24 * 60 * 60_000;

  for (const change of delta.changes) {
    const sourceId = `google:${change.eventId}`;
    const saved = proposalsBySource.get(sourceId);
    const commitment = commitmentsByExternalId.get(change.eventId);
    if (change.deleted) {
      if (commitment && commitment.status !== 'DROPPED' && commitment.status !== 'COMPLETE') {
        if (saved?.source.version === change.version && saved.status === 'PENDING_REVIEW') continue;
        const previous = commitmentSnapshot(commitment, state.horizonStartIso, state.timezone ?? 'UTC');
        const result = await store.saveGraphProposal(accountId, {
          source: { id: sourceId, ...previous, version: change.version, etag: change.etag, changeType: 'CANCELLED', previous },
          draft: draftFromCommitment(commitment, 'Google Calendar reports that this event was cancelled.'),
          model: { provider: 'calendar-source-sync', generatedAtIso: new Date().toISOString() },
        });
        if (result) { proposals += 1; cancelled += 1; }
        continue;
      }
      if (saved?.status === 'PENDING_REVIEW') {
        const previous = saved.source;
        const result = await store.saveGraphProposal(accountId, {
          source: { ...previous, version: change.version, changeType: 'CANCELLED' },
          draft: saved.draft,
          model: saved.model,
        }, 'IGNORED');
        if (result) excluded += 1;
      }
      continue;
    }

    const event = change.event;
    if (!event) throw new Error(`Calendar sync returned no event data for ${change.eventId}`);
    if (commitment && (commitment.status === 'DROPPED' || commitment.status === 'COMPLETE')) continue;
    const source = {
      id: sourceId,
      title: event.title,
      startIso: event.startIso,
      endIso: event.endIso,
      version: change.version,
      etag: change.etag,
      changeType: commitment ? 'UPDATED' as const : 'NEW' as const,
      ...(commitment ? { previous: commitmentSnapshot(commitment, state.horizonStartIso, state.timezone ?? 'UTC') } : {}),
    };
    if (saved?.source.version === change.version) continue;
    if (commitment && commitment.status !== 'DROPPED' && commitment.status !== 'COMPLETE'
      && commitmentMatchesEvent(commitment, event.title, event.startIso, event.endIso, state.horizonStartIso, state.timezone ?? 'UTC')) {
      continue;
    }
    const startsAt = Date.parse(event.startIso);
    if (!commitment && (!Number.isFinite(startsAt) || startsAt < now || startsAt >= horizonEnd)) continue;

    if (commitment) {
      const result = await store.saveGraphProposal(accountId, {
        source,
        draft: draftFromCommitment(commitment, 'This Calendar event changed. Review the new source details before updating its graph commitment.'),
        model: { provider: 'calendar-source-sync', generatedAtIso: new Date().toISOString() },
      });
      if (result) { proposals += 1; updated += 1; }
      continue;
    }

    const builder = new CalendarGraphBuilder();
    const result = await builder.propose(source);
    const savedResult = await store.saveGraphProposal(accountId, {
      source: result.source,
      draft: result.draft,
      model: result.model,
    }, result.draft.include ? 'PENDING_REVIEW' : 'IGNORED');
    if (savedResult) {
      if (result.draft.include) proposals += 1;
      else excluded += 1;
    }
  }

  if (delta.reset) {
    for (const commitment of commitmentsByExternalId.values()) {
      if (!commitment.externalId || fullSyncEventIds.has(commitment.externalId)
        || commitment.status === 'DROPPED' || commitment.status === 'COMPLETE') continue;
      const previous = commitmentSnapshot(commitment, state.horizonStartIso, state.timezone ?? 'UTC');
      const result = await store.saveGraphProposal(accountId, {
        source: {
          id: `google:${commitment.externalId}`,
          ...previous,
          version: `missing:${delta.nextSyncToken}`,
          changeType: 'CANCELLED',
          previous,
        },
        draft: draftFromCommitment(commitment, 'This event was not present after Calendar required a full resync.'),
        model: { provider: 'calendar-source-sync', generatedAtIso: new Date().toISOString() },
      });
      if (result) { proposals += 1; cancelled += 1; }
    }
    for (const saved of savedProposals) {
      if (saved.status !== 'PENDING_REVIEW' || !saved.sourceId.startsWith('google:')) continue;
      const externalId = saved.sourceId.slice('google:'.length);
      if (fullSyncEventIds.has(externalId) || commitmentsByExternalId.has(externalId)) continue;
      const result = await store.saveGraphProposal(accountId, {
        source: { ...saved.source, version: `missing:${delta.nextSyncToken}`, changeType: 'CANCELLED' },
        draft: saved.draft,
        model: saved.model,
      }, 'IGNORED');
      if (result) excluded += 1;
    }
  }

  // Commit the cursor last; proposal upserts are version-idempotent if a retry is needed.
  await store.saveSourceSyncCursor(accountId, 'google-calendar', delta.nextSyncToken);
  return {
    changes: delta.changes.length,
    proposals,
    updated,
    cancelled,
    excluded,
    reset: delta.reset,
    syncedAtIso: new Date().toISOString(),
  };
}

/** Start opt-in five-minute polling for account ids provisioned by the trusted host. */
export function startConfiguredCalendarPolling(
  getStore: () => Promise<PostgresAccountStore>,
  getAccessToken: (store: PostgresAccountStore, accountId: string) => Promise<string>,
): NodeJS.Timeout | undefined {
  const accountIds = [...new Set((process.env.DIRA_CALENDAR_SYNC_ACCOUNT_IDS ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean))];
  if (!accountIds.length) return undefined;
  const configuredInterval = Number(process.env.DIRA_CALENDAR_POLL_INTERVAL_MS ?? 5 * 60_000);
  const intervalMs = Number.isFinite(configuredInterval) && configuredInterval >= 60_000
    ? Math.min(configuredInterval, 60 * 60_000)
    : 5 * 60_000;
  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      const store = await getStore();
      for (const accountId of accountIds) {
        try {
          const policy = await store.getAccountPolicySettings(accountId);
          if (!policy.calendarAutoSync || policy.fencedCalendarIds.includes('primary')) continue;
          const credential = await store.getCredential(accountId, 'google');
          if (!credential?.scopes.includes(CALENDAR_READ_SCOPE)) continue;
          const summary = await syncAccountCalendarChanges(store, accountId, () => getAccessToken(store, accountId));
          if (!summary.busy && summary.changes > 0) {
            console.info(JSON.stringify({
              severity: 'INFO', msg: 'calendar source sync completed',
              changes: summary.changes, proposals: summary.proposals,
              updated: summary.updated, cancelled: summary.cancelled, reset: summary.reset,
            }));
          }
        } catch (error) {
          console.error(JSON.stringify({
            severity: 'WARN', msg: 'calendar source sync failed',
            failure: error instanceof Error ? error.message : String(error),
          }));
        }
      }
    } catch (error) {
      console.error(JSON.stringify({
        severity: 'ERROR', msg: 'calendar poller could not access account storage',
        failure: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void poll(), intervalMs);
  timer.unref();
  void poll();
  return timer;
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

function commitmentMatchesEvent(
  commitment: Commitment,
  title: string,
  startIso: string,
  endIso: string,
  horizonStartIso: string,
  timezone: string,
): boolean {
  if (commitment.title !== title) return false;
  const previous = commitmentSnapshot(commitment, horizonStartIso, timezone);
  return sameAtSourcePrecision(previous.startIso, startIso, timezone)
    && sameAtSourcePrecision(previous.endIso, endIso, timezone);
}

function sameAtSourcePrecision(previous: string, current: string, timezone: string): boolean {
  const currentIsDate = /^\d{4}-\d{2}-\d{2}$/.test(current);
  const previousIsDate = /^\d{4}-\d{2}-\d{2}$/.test(previous);
  if (currentIsDate && !previousIsDate) {
    return localDate(previous, timezone) === current;
  }
  if (previousIsDate && !currentIsDate) {
    return previous === localDate(current, timezone);
  }
  return Date.parse(previous) === Date.parse(current);
}

function localDate(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function draftFromCommitment(commitment: Commitment, reason: string) {
  return {
    include: true,
    title: commitment.title,
    domain: commitment.domain,
    kind: commitment.kind,
    flexibility: commitment.flexibility === 'MOVE_WITHIN_WINDOW' || commitment.flexibility === 'DELEGATABLE'
      ? 'FIXED' as const
      : commitment.flexibility,
    criticality: commitment.criticality,
    estimatedEffortMin: commitment.kind === 'effort' ? commitment.requiredEffortMin ?? null : null,
    confidence: commitment.confidence,
    reason,
  };
}

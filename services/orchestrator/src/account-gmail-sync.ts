import { EmailGraphBuilder } from '@dira/agent';
import { GoogleUserGmailTool } from '@dira/adapter-gmail/user-google';
import { commitmentStakeholders } from '@dira/commitment-model';
import type { PostgresAccountStore } from './postgres-store.js';
import { handleAccountEmail, liveModelConfigured, type AccountRepairOptions } from './account-repair.js';

const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export interface GmailSyncSummary {
  messages: number;
  proposalsCreated: number;
  ignored: number;
  /** Messages from a declared authority that started the repair engine. */
  repairsStarted?: number;
  reset: boolean;
  syncedAtIso: string;
  busy?: boolean;
}

export async function syncAccountGmailChanges(
  store: PostgresAccountStore,
  accountId: string,
  getAccessToken: () => Promise<string>,
  repairOptions: AccountRepairOptions = {},
): Promise<GmailSyncSummary> {
  const locked = await store.withAdvisoryJobLock(accountId, 'gmail-sync', () =>
    performGmailSync(store, accountId, getAccessToken, repairOptions));
  if (locked.acquired) return locked.value;
  return { messages: 0, proposalsCreated: 0, ignored: 0, reset: false, syncedAtIso: new Date().toISOString(), busy: true };
}

/** Starts the five-minute Gmail worker only for accounts provisioned by the host. */
export function startConfiguredGmailPolling(
  getStore: () => Promise<PostgresAccountStore>,
  getAccessToken: (store: PostgresAccountStore, accountId: string) => Promise<string>,
): NodeJS.Timeout | undefined {
  const accountIds = [...new Set((process.env.DIRA_GMAIL_SYNC_ACCOUNT_IDS ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean))];
  if (!accountIds.length) return undefined;
  const configuredInterval = Number(process.env.DIRA_GMAIL_POLL_INTERVAL_MS ?? 5 * 60_000);
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
          if (!policy.gmailAutoSync || policy.fencedGmail) continue;
          const credential = await store.getCredential(accountId, 'google');
          if (!credential?.scopes.includes(GMAIL_READ_SCOPE)) continue;
          const summary = await syncAccountGmailChanges(store, accountId, () => getAccessToken(store, accountId));
          if (!summary.busy && summary.messages > 0) {
            console.info(JSON.stringify({
              severity: 'INFO', msg: 'gmail source sync completed',
              messages: summary.messages, proposals: summary.proposalsCreated,
              ignored: summary.ignored, reset: summary.reset,
            }));
          }
        } catch (error) {
          console.error(JSON.stringify({
            severity: 'WARN', msg: 'gmail source sync failed',
            failure: error instanceof Error ? error.message : String(error),
          }));
        }
      }
    } catch (error) {
      console.error(JSON.stringify({
        severity: 'ERROR', msg: 'gmail poller could not access account storage',
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

async function performGmailSync(
  store: PostgresAccountStore,
  accountId: string,
  getAccessToken: () => Promise<string>,
  repairOptions: AccountRepairOptions,
): Promise<GmailSyncSummary> {
  const policy = await store.getAccountPolicySettings(accountId);
  if (policy.fencedGmail) {
    const reason = 'Gmail is fenced by account policy.';
    await store.recordPolicyBlock(accountId, {
      actionType: 'SYNC_GMAIL', targetId: 'gmail', policyRule: 'fenced-gmail', reason,
    });
    throw new Error(reason);
  }
  const credential = await store.getCredential(accountId, 'google');
  if (!credential?.scopes.includes(GMAIL_READ_SCOPE)) {
    throw new Error('Grant Gmail read access before syncing new messages.');
  }

  const tool = new GoogleUserGmailTool(getAccessToken);
  const cursor = await store.getSourceSyncCursor(accountId, 'gmail');
  const [state, savedProposals, account] = await Promise.all([
    store.ensureDomainState(accountId),
    store.listGraphProposals(accountId),
    store.getAccount(accountId),
  ]);
  const fencedSenders = new Map(Object.values(state.people)
    .filter((person) => policy.fencedPersonIds.includes(person.id))
    .map((person) => [person.email.trim().toLowerCase(), person.id]));
  const delta = await tool.syncMessages(cursor, fencedSenders);
  const savedBySource = new Map(savedProposals.map((proposal) => [proposal.sourceId, proposal]));
  const builder = new EmailGraphBuilder();
  let proposalsCreated = 0;
  let repairsStarted = 0;
  let ignored = delta.fencedMessages.length;
  const profile = await store.getAvailabilityProfile(accountId);
  // People the owner explicitly tied to a commitment (participant, user-confirmed
  // authority, or stored backup). Only their mail can change an existing commitment.
  const stakeholderEmails = new Set<string>();
  for (const id of Object.keys(state.commitments)) {
    for (const personId of commitmentStakeholders(state, id)) {
      const email = state.people[personId]?.email.trim().toLowerCase();
      if (email) stakeholderEmails.add(email);
    }
  }
  const ownerEmail = (account?.email ?? delta.accountEmail).toLowerCase();

  for (const fenced of delta.fencedMessages) {
    await store.recordPolicyBlock(accountId, {
      actionType: 'READ_GMAIL_MESSAGE', targetId: fenced.personId,
      policyRule: 'fenced-person', reason: 'Message content from this contact was not fetched under account person-fence policy.',
    });
  }

  for (const message of delta.messages) {
    const messageAddress = message.from.match(/<([^>]+)>/)?.[1] ?? message.from;
    if (ownerEmail && messageAddress.toLowerCase() === ownerEmail) continue;
    const sourceId = `gmail:${message.id}`;
    const saved = savedBySource.get(sourceId);
    if (saved?.source.version === message.id) continue;
    if (profile && liveModelConfigured() && stakeholderEmails.has(messageAddress.trim().toLowerCase())) {
      // A known stakeholder may be changing an existing commitment: the same
      // interpret → gate → propagate → plan → policy → broker path as the demo.
      // The engine dedupes by event id, so a retried sync never repeats a run.
      const repair = await handleAccountEmail(store, accountId, {
        eventId: sourceId,
        source: 'gmail',
        threadId: message.threadId,
        messageId: message.id,
        from: messageAddress,
        to: ownerEmail,
        subject: message.subject,
        body: message.body.slice(0, 8_000),
        receivedAtIso: message.receivedAtIso,
      }, repairOptions);
      // Not a change to an existing commitment: it may still be a new one.
      if (repair.run.status !== 'NO_ACTION_NEEDED') {
        repairsStarted += 1;
        continue;
      }
    }
    const result = await builder.propose({
      id: sourceId,
      from: message.from,
      subject: message.subject,
      receivedAtIso: message.receivedAtIso,
      body: message.body,
      timezone: state.timezone ?? 'UTC',
    });
    const source = {
      ...result.source,
      ...(result.source.evidenceQuote ? { evidenceQuote: result.source.evidenceQuote.slice(0, 500) } : {}),
    };
    const savedResult = await store.saveGraphProposal(accountId, {
      sourceType: 'gmail',
      source,
      draft: result.draft,
      model: result.model,
    }, result.draft.include ? 'PENDING_REVIEW' : 'IGNORED');
    if (savedResult) {
      if (result.draft.include) proposalsCreated += 1;
      else ignored += 1;
    }
  }

  // Like Calendar sync, the Gmail watermark advances only after every message
  // is durably represented as a pending proposal or an ignored source.
  await store.saveSourceSyncCursor(accountId, 'gmail', delta.nextHistoryId);
  return {
    messages: delta.messages.length + delta.fencedMessages.length,
    proposalsCreated,
    ignored,
    repairsStarted,
    reset: delta.reset,
    syncedAtIso: new Date().toISOString(),
  };
}

import { EmailGraphBuilder } from '@dira/agent';
import { GoogleUserGmailTool } from '@dira/adapter-gmail/user-google';
import type { PostgresAccountStore } from './postgres-store.js';

const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export interface GmailSyncSummary {
  messages: number;
  proposalsCreated: number;
  ignored: number;
  reset: boolean;
  syncedAtIso: string;
  busy?: boolean;
}

export async function syncAccountGmailChanges(
  store: PostgresAccountStore,
  accountId: string,
  getAccessToken: () => Promise<string>,
): Promise<GmailSyncSummary> {
  const locked = await store.withAdvisoryJobLock(accountId, 'gmail-sync', () =>
    performGmailSync(store, accountId, getAccessToken));
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
  const delta = await tool.syncMessages(cursor);
  const [state, savedProposals, account] = await Promise.all([
    store.ensureDomainState(accountId),
    store.listGraphProposals(accountId),
    store.getAccount(accountId),
  ]);
  const savedBySource = new Map(savedProposals.map((proposal) => [proposal.sourceId, proposal]));
  const builder = new EmailGraphBuilder();
  let proposalsCreated = 0;
  let ignored = 0;
  const ownerEmail = (account?.email ?? delta.accountEmail).toLowerCase();

  for (const message of delta.messages) {
    const messageAddress = message.from.match(/<([^>]+)>/)?.[1] ?? message.from;
    if (ownerEmail && messageAddress.toLowerCase() === ownerEmail) continue;
    const sourceId = `gmail:${message.id}`;
    const saved = savedBySource.get(sourceId);
    if (saved?.source.version === message.id) continue;
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
    messages: delta.messages.length,
    proposalsCreated,
    ignored,
    reset: delta.reset,
    syncedAtIso: new Date().toISOString(),
  };
}

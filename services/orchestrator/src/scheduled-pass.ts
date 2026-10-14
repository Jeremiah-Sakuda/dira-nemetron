import { timingSafeEqual } from 'node:crypto';
import type { PostgresAccountStore } from './postgres-store.js';
import type { AccountRepairOptions } from './account-repair.js';
import { googleAccessToken } from './google-auth.js';
import { runDailyJobsForAccounts } from './account-daily-jobs.js';
import { syncAccountCalendarChanges } from './account-calendar-sync.js';
import { syncAccountGmailChanges } from './account-gmail-sync.js';
import { syncAccountIcalFeed } from './account-ical-sync.js';
import { deleteExpiredDemoAccounts } from './account-records.js';

export function scheduledRequestAuthorized(authorization: string | undefined): boolean {
  const secret = process.env.DIRA_SCHEDULER_SECRET;
  if (!secret || secret.length < 32 || !authorization) return false;
  const actual = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function accounts(name: string): string[] {
  return [...new Set((process.env[name] ?? '').split(',').map(x => x.trim()).filter(Boolean))];
}

/** Host-provisioned accounts only; every connector still requires owner opt-in. */
export async function runScheduledPass(
  store: PostgresAccountStore,
  mirror: (store: PostgresAccountStore, accountId: string) => Promise<void>,
  options: (store: PostgresAccountStore, accountId: string) => AccountRepairOptions,
  now = new Date(),
): Promise<{ completed: number; failed: number; expiredDemosRemoved: number }> {
  let completed = 0;
  let failed = 0;
  const run = async (action: () => Promise<unknown>) => {
    try { await action(); completed++; } catch { failed++; }
  };
  for (const id of accounts('DIRA_CALENDAR_SYNC_ACCOUNT_IDS')) await run(async () => {
    const [policy, credential] = await Promise.all([store.getAccountPolicySettings(id), store.getCredential(id, 'google')]);
    if (policy.calendarAutoSync && !policy.fencedCalendarIds.includes('primary')
      && credential?.scopes.includes('https://www.googleapis.com/auth/calendar.readonly')) {
      await syncAccountCalendarChanges(store, id, () => googleAccessToken(store, id));
      await mirror(store, id);
    }
  });
  for (const id of accounts('DIRA_GMAIL_SYNC_ACCOUNT_IDS')) await run(async () => {
    const [policy, credential] = await Promise.all([store.getAccountPolicySettings(id), store.getCredential(id, 'google')]);
    if (policy.gmailAutoSync && !policy.fencedGmail
      && credential?.scopes.includes('https://www.googleapis.com/auth/gmail.readonly')) {
      await syncAccountGmailChanges(store, id, () => googleAccessToken(store, id), options(store, id));
      await mirror(store, id);
    }
  });
  for (const id of accounts('DIRA_ICAL_SYNC_ACCOUNT_IDS')) await run(async () => {
    for (const feed of await store.listIcalFeeds(id)) {
      if (feed.enabled && feed.autoSync) await syncAccountIcalFeed(store, id, feed.feedId);
    }
    await mirror(store, id);
  });
  await run(() => runDailyJobsForAccounts(store, accounts('DIRA_DAILY_JOB_ACCOUNT_IDS'), mirror, now, true));
  const expiredDemosRemoved = await deleteExpiredDemoAccounts(store);
  return { completed, failed, expiredDemosRemoved };
}

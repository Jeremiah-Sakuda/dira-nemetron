import { PostgresAccountStore } from '../services/orchestrator/src/postgres-store.js';
import { runDailyJobsForAccounts } from '../services/orchestrator/src/account-daily-jobs.js';
import { syncAccountMemory } from '../services/orchestrator/src/account-memory.js';
import { installEgressGuard } from '../services/orchestrator/src/egress-guard.js';

/**
 * One idempotent pass of the 02:00 recompute and 07:00 summary for the
 * allowlisted accounts. Run by a Nebius Serverless Job (or cron) with the same
 * environment as the orchestrator: DATABASE_URL, DIRA_DAILY_JOB_ACCOUNT_IDS,
 * DIRA_MEMORY_ROOT, and optional Telegram settings.
 */
installEgressGuard();
const accountIds = [...new Set((process.env.DIRA_DAILY_JOB_ACCOUNT_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean))];
if (!accountIds.length) {
  console.log('DIRA_DAILY_JOB_ACCOUNT_IDS is empty; nothing to do.');
  process.exit(0);
}
const store = new PostgresAccountStore();
await store.initialize();
try {
  await runDailyJobsForAccounts(store, accountIds, async (target, accountId) => {
    await syncAccountMemory(accountId, async () => {
      const [state, profile, policy] = await Promise.all([
        target.ensureDomainState(accountId), target.getAvailabilityProfile(accountId), target.getAccountPolicySettings(accountId),
      ]);
      return { state, profile, policy };
    });
  });
  console.log(JSON.stringify({ severity: 'INFO', msg: 'daily job pass complete', accounts: accountIds.length }));
} finally {
  await store.close();
}

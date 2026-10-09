import { analyzeAccountSchedule, availabilityIntervals, rebaseDomainState } from './account-planning.js';
import type { PostgresAccountStore, StoredDailyScheduleReport } from './postgres-store.js';

const NIGHTLY_MINUTE = 2 * 60;
const MORNING_MINUTE = 7 * 60;

/** Run durable, idempotent local-time schedule jobs for trusted host allowlisted accounts. */
export function startConfiguredAccountDailyJobs(
  getStore: () => Promise<PostgresAccountStore>,
  mirrorMemory: (store: PostgresAccountStore, accountId: string) => Promise<void>,
): NodeJS.Timeout | undefined {
  const accountIds = [...new Set((process.env.DIRA_DAILY_JOB_ACCOUNT_IDS ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean))];
  if (!accountIds.length) return undefined;
  let running = false;

  const poll = async () => {
    if (running) return;
    running = true;
    try {
      const store = await getStore();
      for (const accountId of accountIds) {
        try {
          const account = await store.getAccount(accountId);
          if (!account) continue;
          const clock = localClock(new Date(), account.timezone);
          if (clock.minuteOfDay >= NIGHTLY_MINUTE) {
            await runDailyReport(store, accountId, clock.localDate, 'NIGHTLY_RECOMPUTE', mirrorMemory);
          }
          if (clock.minuteOfDay >= MORNING_MINUTE) {
            await runDailyReport(store, accountId, clock.localDate, 'MORNING_SUMMARY', mirrorMemory);
          }
        } catch (error) {
          console.error(JSON.stringify({ severity: 'WARN', msg: 'account daily schedule job failed',
            failure: error instanceof Error ? error.message : String(error) }));
        }
      }
    } catch (error) {
      console.error(JSON.stringify({ severity: 'ERROR', msg: 'account daily scheduler could not access account storage',
        failure: error instanceof Error ? error.message : String(error) }));
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void poll(), 60_000);
  timer.unref();
  void poll();
  return timer;
}

async function runDailyReport(
  store: PostgresAccountStore,
  accountId: string,
  localDate: string,
  reportType: StoredDailyScheduleReport['reportType'],
  mirrorMemory: (store: PostgresAccountStore, accountId: string) => Promise<void>,
): Promise<void> {
  const lock = await store.withAdvisoryJobLock(accountId, `daily-report:${reportType}:${localDate}`, async () => {
    if (await store.getDailyScheduleReport(accountId, localDate, reportType)) return false;
    const now = new Date();
    const [state, profile, policy] = await Promise.all([
      store.ensureDomainState(accountId),
      store.getAvailabilityProfile(accountId),
      store.getAccountPolicySettings(accountId),
    ]);
    const rebased = rebaseDomainState(state, now);
    if (profile) rebased.availability = availabilityIntervals(profile, rebased, now);
    await store.saveDomainState(accountId, rebased);
    await mirrorMemory(store, accountId);
    const analysis = analyzeAccountSchedule(rebased, policy);
    const report = {
      localDate,
      timezone: rebased.timezone ?? 'UTC',
      generatedAtIso: new Date().toISOString(),
      checkedAtIso: analysis.checkedAtIso,
      globalSlackMinutes: analysis.feasibility.globalSlackMinutes,
      violations: analysis.feasibility.violations,
      plans: analysis.plans.slice(0, 3),
      calendarFenced: analysis.calendarFenced,
    };
    return await store.saveDailyScheduleReport(accountId, localDate, reportType, report);
  });

  if (lock.acquired && lock.value) {
    console.info(JSON.stringify({ severity: 'INFO', msg: 'account schedule report generated', reportType, localDate }));
  }
}

function localClock(date: Date, timezone: string): { localDate: string; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    localDate: `${get('year')}-${get('month')}-${get('day')}`,
    minuteOfDay: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

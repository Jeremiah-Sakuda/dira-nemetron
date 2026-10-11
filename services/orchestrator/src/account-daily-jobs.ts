import { analyzeAccountSchedule, availabilityIntervals, rebaseDomainState } from './account-planning.js';
import type { PostgresAccountStore, StoredDailyScheduleReport } from './postgres-store.js';
import { pruneFlightRecords } from './account-records.js';
import { sendTelegramText } from './telegram.js';

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
      await runDailyJobsForAccounts(await getStore(), accountIds, mirrorMemory);
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

/**
 * One pass of the daily jobs. The always-on VM calls this every minute; a
 * Nebius Serverless Job can run the same pass on a schedule
 * (scripts/daily-job.ts). Both are idempotent per account and local date.
 */
export async function runDailyJobsForAccounts(
  store: PostgresAccountStore,
  accountIds: readonly string[],
  mirrorMemory: (store: PostgresAccountStore, accountId: string) => Promise<void>,
  now = new Date(),
): Promise<void> {
  for (const accountId of accountIds) {
    try {
      const account = await store.getAccount(accountId);
      if (!account) continue;
      const clock = localClock(now, account.timezone);
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
    const saved = await store.saveDailyScheduleReport(accountId, localDate, reportType, report);
    if (saved && reportType === 'NIGHTLY_RECOMPUTE') {
      await pruneFlightRecords(store, accountId, policy.flightRetentionDays);
    }
    if (saved && reportType === 'MORNING_SUMMARY') {
      const pending = (await store.listPendingApprovals(accountId)).length;
      await sendTelegramText(store, accountId, morningText(report, pending, policy.correctionRules.length))
        .catch((error) => console.error('morning summary delivery failed', error));
    }
    return saved;
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

/** The 07:00 summary as a short chat message. It reports; it never acts. */
export function morningText(
  report: { localDate: string; globalSlackMinutes: number; violations: { detail: string }[]; plans: { label: string }[] },
  pendingApprovals: number,
  activeRules: number,
): string {
  const hours = (Math.abs(report.globalSlackMinutes) / 60).toFixed(1);
  const lines = [
    `Good morning. Dira checked your schedule for ${report.localDate}.`,
    report.violations.length
      ? `${report.violations.length} thing${report.violations.length === 1 ? '' : 's'} won't fit: ${report.violations.slice(0, 3).map((item) => item.detail).join('; ')}.`
      : `Everything fits, with ${report.globalSlackMinutes < 0 ? '-' : ''}${hours}h of slack at the tightest point.`,
    report.violations.length && report.plans[0] ? `Best repair: ${report.plans[0].label}. Open Dira to review it.` : '',
    pendingApprovals ? `${pendingApprovals} action${pendingApprovals === 1 ? '' : 's'} waiting for your OK.` : '',
    activeRules ? `${activeRules} rule${activeRules === 1 ? '' : 's'} you taught Dira are active.` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

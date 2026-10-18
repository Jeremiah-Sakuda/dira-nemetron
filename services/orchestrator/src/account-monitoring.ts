import type { PostgresAccountStore } from './postgres-store.js';

export function monitoringState(input: { connected: boolean; fenced: boolean; optedIn: boolean; enrolled: boolean }): string {
  if (!input.connected) return 'disconnected';
  if (input.fenced) return 'fenced';
  if (!input.optedIn) return 'paused by you';
  if (!input.enrolled) return 'awaiting deployment enrollment';
  return 'scheduled';
}
export async function accountMonitoring(store: PostgresAccountStore, accountId: string) {
  const [policy, credential, cursors, summary] = await Promise.all([
    store.getAccountPolicySettings(accountId), store.getCredential(accountId,'google'),
    store.withAccount(accountId, client => client.query<{source:string;updated_at:Date}>(
      'SELECT source, updated_at FROM dira_source_sync_cursors WHERE account_id = $1',[accountId])),
    store.getLatestDailyScheduleReport(accountId,'MORNING_SUMMARY'),
  ]);
  const enrolled = (name:string) => (process.env[name] ?? '').split(',').map(x=>x.trim()).includes(accountId);
  const items = [
    {name:'Google Calendar',source:'google-calendar',scope:'https://www.googleapis.com/auth/calendar.readonly',fenced:policy.fencedCalendarIds.includes('primary'),optedIn:policy.calendarAutoSync,job:'DIRA_CALENDAR_SYNC_ACCOUNT_IDS'},
    {name:'Gmail',source:'gmail',scope:'https://www.googleapis.com/auth/gmail.readonly',fenced:policy.fencedGmail,optedIn:policy.gmailAutoSync,job:'DIRA_GMAIL_SYNC_ACCOUNT_IDS'},
  ].map(item => ({name:item.name,status:monitoringState({connected:credential?.scopes.includes(item.scope) ?? false,fenced:item.fenced,optedIn:item.optedIn,enrolled:enrolled(item.job)}),
    lastSuccessfulSyncAtIso:cursors.rows.find(row=>row.source===item.source)?.updated_at.toISOString() ?? null}));
  return {checkedAtIso:new Date().toISOString(),sources:items,dailySummaryEnrolled:enrolled('DIRA_DAILY_JOB_ACCOUNT_IDS'),latestSummary:summary?.report.generatedAtIso ?? null,
    disclosure:'Scheduled means configured for the shared 15-minute scheduler, not proof of a successful run. A last-success timestamp does not prove current token validity. Review source changes before they become graph authority.'};
}

import { createHash, randomUUID } from 'node:crypto';
import type { ActionRecord } from '@dira/action-ledger';
import { minutesToIso, type DomainState } from '@dira/commitment-model';
import {
  AccountPolicySettingsSchema,
  CorrectionRuleSchema,
  describeCorrectionRule,
  type StoredCorrectionRule,
} from './account-policy.js';
import type { PostgresAccountStore } from './postgres-store.js';

/**
 * Correction-to-rule capture (PRD P0.5). When the owner rejects or edits an
 * action and says why, Dira proposes a narrow rule. It stays a candidate
 * until the owner confirms it; only confirmed rules reach the policy engine,
 * the planner, the memory repo, and the read-only Hermes Skills mirror.
 */

export const CORRECTION_REASONS = ['protect', 'not-this-time', 'never-contact', 'ask-first'] as const;
export type CorrectionReason = typeof CORRECTION_REASONS[number];

export interface RuleCandidate {
  candidateId: string;
  status: 'CANDIDATE' | 'CONFIRMED' | 'DISMISSED';
  rule: StoredCorrectionRule;
  sentence: string;
  source: { actionId: string; workflowId: string; summary: string; reason: CorrectionReason };
  createdAtIso: string;
}

const ACTION_VERBS: Partial<Record<ActionRecord['action']['type'], string>> = {
  MOVE_CALENDAR_EVENT: 'move a calendar event',
  CREATE_CALENDAR_EVENT: 'add a calendar event',
  DELETE_CALENDAR_EVENT: 'remove a calendar event',
  DELEGATE_TASK: 'hand a task to someone else',
  SEND_NOTIFICATION: 'send a message',
  BOOK_INTERVIEW_SLOT: 'accept an offered time',
};

/** Derive the narrowest rule that captures the owner's correction. */
export function deriveCorrectionRule(
  state: DomainState,
  record: ActionRecord,
  reason: CorrectionReason,
): StoredCorrectionRule | undefined {
  const action = record.action;
  const desired = action.desired_state as Record<string, unknown>;
  const id = `rule-${randomUUID().slice(0, 13)}`;
  switch (reason) {
    case 'protect': {
      const target = state.commitments[action.target];
      if (!target) return undefined;
      return { id, kind: 'PROTECT_COMMITMENT', commitmentId: target.id, label: `“${target.title.slice(0, 120)}”` };
    }
    case 'never-contact': {
      const personId = typeof desired.recipient_person_id === 'string' ? desired.recipient_person_id
        : typeof desired.new_owner === 'string' ? desired.new_owner : undefined;
      const person = personId ? state.people[personId] : undefined;
      if (!person) return undefined;
      return { id, kind: 'NEVER_CONTACT', personId: person.id, label: person.name.slice(0, 120) };
    }
    case 'ask-first': {
      const verb = ACTION_VERBS[action.type];
      if (!verb || action.type === 'DECLINE_INTERVIEW') return undefined;
      return { id, kind: 'ASK_FIRST', actionType: action.type as Extract<StoredCorrectionRule, { kind: 'ASK_FIRST' }>['actionType'], label: verb };
    }
    case 'not-this-time': {
      const start = typeof desired.start_min === 'number' ? desired.start_min : undefined;
      const duration = typeof desired.duration_min === 'number' ? desired.duration_min : undefined;
      if (start === undefined || duration === undefined) return undefined;
      const timezone = state.timezone ?? 'UTC';
      const local = localClock(minutesToIso(start, state.horizonStartIso, timezone));
      const localEnd = localClock(minutesToIso(start + duration, state.horizonStartIso, timezone));
      // Round outward to whole hours so the rule names a recognizable window.
      const startMinute = Math.floor(local.minuteOfDay / 60) * 60;
      const endMinute = localEnd.weekday === local.weekday
        ? Math.min(1440, Math.ceil(localEnd.minuteOfDay / 60) * 60)
        : 1440;
      if (endMinute <= startMinute) return undefined;
      const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][local.weekday];
      return {
        id, kind: 'AVOID_WINDOW', weekdays: [local.weekday], startMinute, endMinute,
        label: `${day} ${hourLabel(startMinute)}–${hourLabel(endMinute)}`,
      };
    }
  }
}

export async function captureRuleCandidate(
  store: PostgresAccountStore,
  accountId: string,
  record: ActionRecord,
  reason: CorrectionReason,
): Promise<RuleCandidate | undefined> {
  const state = await store.loadDomainState(accountId);
  if (!state) return undefined;
  const rule = deriveCorrectionRule(state, record, reason);
  if (!rule) return undefined;
  CorrectionRuleSchema.parse(rule);
  const candidateId = `cand-${randomUUID()}`;
  const source = { actionId: record.actionId, workflowId: record.workflowId, summary: record.action.summary.slice(0, 300), reason };
  const inserted = await store.withAccount(accountId, async (client) => {
    const result = await client.query(
      `INSERT INTO dira_rule_candidates (account_id, candidate_id, status, rule, source, rule_key)
       VALUES ($1, $2, 'CANDIDATE', $3::jsonb, $4::jsonb, $5)
       ON CONFLICT DO NOTHING`,
      [accountId, candidateId, JSON.stringify(rule), JSON.stringify(source), ruleKey(rule)],
    );
    return (result.rowCount ?? 0) > 0;
  });
  if (!inserted) return undefined;
  return { candidateId, status: 'CANDIDATE', rule, sentence: describeCorrectionRule(rule), source, createdAtIso: new Date().toISOString() };
}

export async function listRules(store: PostgresAccountStore, accountId: string) {
  const [policy, candidates] = await Promise.all([
    store.getAccountPolicySettings(accountId),
    store.withAccount(accountId, async (client) => {
      const result = await client.query<{ candidate_id: string; status: RuleCandidate['status']; rule: StoredCorrectionRule; source: RuleCandidate['source']; created_at: Date }>(
        `SELECT candidate_id, status, rule, source, created_at FROM dira_rule_candidates
         WHERE account_id = $1 AND status = 'CANDIDATE' ORDER BY created_at DESC LIMIT 50`,
        [accountId],
      );
      return result.rows;
    }),
  ]);
  return {
    confirmed: policy.correctionRules.map((rule) => ({ ...rule, sentence: describeCorrectionRule(rule) })),
    candidates: candidates.map((row) => ({
      candidateId: row.candidate_id, status: row.status, rule: row.rule, sentence: describeCorrectionRule(row.rule),
      source: row.source, createdAtIso: row.created_at.toISOString(),
    })),
  };
}

/** Confirm a candidate: it joins the policy settings (and so the policy version) in one transaction. */
export async function decideRuleCandidate(
  store: PostgresAccountStore,
  accountId: string,
  candidateId: string,
  decision: 'CONFIRMED' | 'DISMISSED',
): Promise<StoredCorrectionRule | undefined> {
  return store.withAccount(accountId, async (client) => {
    const selected = await client.query<{ rule: StoredCorrectionRule; status: string }>(
      'SELECT rule, status FROM dira_rule_candidates WHERE account_id = $1 AND candidate_id = $2 FOR UPDATE',
      [accountId, candidateId],
    );
    const row = selected.rows[0];
    if (!row || row.status !== 'CANDIDATE') throw new Error('rule candidate is no longer open');
    const rule = CorrectionRuleSchema.parse(row.rule);
    await client.query(
      'UPDATE dira_rule_candidates SET status = $3, decided_at = now() WHERE account_id = $1 AND candidate_id = $2',
      [accountId, candidateId, decision],
    );
    if (decision === 'DISMISSED') return undefined;
    const current = await client.query<{ policy: unknown }>(
      'SELECT policy FROM dira_account_policy_settings WHERE account_id = $1 FOR UPDATE', [accountId],
    );
    const policy = AccountPolicySettingsSchema.parse(current.rows[0]?.policy ?? {});
    if (policy.correctionRules.some((existing) => ruleKey(existing) === ruleKey(rule))) return rule;
    const next = AccountPolicySettingsSchema.parse({ ...policy, correctionRules: [...policy.correctionRules, rule] });
    await client.query(
      `INSERT INTO dira_account_policy_settings (account_id, policy) VALUES ($1, $2::jsonb)
       ON CONFLICT (account_id) DO UPDATE SET policy = EXCLUDED.policy, updated_at = now()`,
      [accountId, JSON.stringify(next)],
    );
    return rule;
  });
}

export async function deleteConfirmedRule(store: PostgresAccountStore, accountId: string, ruleId: string): Promise<boolean> {
  const policy = await store.getAccountPolicySettings(accountId);
  const remaining = policy.correctionRules.filter((rule) => rule.id !== ruleId);
  if (remaining.length === policy.correctionRules.length) return false;
  await store.saveAccountPolicySettings(accountId, { ...policy, correctionRules: remaining }, { replaceCorrectionRules: true });
  return true;
}

function ruleKey(rule: StoredCorrectionRule): string {
  const { id: _id, label: _label, ...shape } = rule;
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 32);
}

function localClock(offsetIso: string): { weekday: number; minuteOfDay: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(offsetIso)!;
  const weekday = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
  return { weekday, minuteOfDay: Number(match[4]) * 60 + Number(match[5]) };
}

function hourLabel(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  if (minute === 1440) return 'midnight';
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`;
}

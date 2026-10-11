import { randomUUID } from 'node:crypto';
import type { ActionRecord } from '@dira/action-ledger';
import type { WorkflowRun } from '@dira/agent';
import type { FlightEntry } from '@dira/observability';
import type { DemoWorld } from './demo-world.js';
import { DEMO_SESSION_TTL_SECONDS } from './demo-world.js';
import type { AccountKind } from './account-tools.js';
import type { PostgresAccountStore } from './postgres-store.js';

/** Account-scoped records for event-driven repair, the demo persona, and audits. All queries run under RLS. */

export async function getAccountKind(store: PostgresAccountStore, accountId: string): Promise<AccountKind | undefined> {
  return store.withAccount(accountId, async (client) => {
    const result = await client.query<{ kind: AccountKind }>('SELECT kind FROM dira_accounts WHERE account_id = $1', [accountId]);
    return result.rows[0]?.kind;
  });
}

export async function createDemoAccount(store: PostgresAccountStore, accountId: string, world: DemoWorld): Promise<void> {
  const expiresAt = new Date(Date.now() + DEMO_SESSION_TTL_SECONDS * 1000);
  await store.withAccount(accountId, async (client) => {
    await client.query(
      `INSERT INTO dira_accounts (account_id, email, timezone, kind, demo_expires_at)
       VALUES ($1, $2, $3, 'demo', $4)`,
      [accountId, `${accountId}@session.dira.demo`, world.state.timezone ?? 'UTC', expiresAt],
    );
    await client.query('INSERT INTO dira_account_state (account_id, state) VALUES ($1, $2::jsonb)', [accountId, JSON.stringify(world.state)]);
    await client.query(
      'INSERT INTO dira_account_policy_settings (account_id, policy) VALUES ($1, $2::jsonb)',
      [accountId, JSON.stringify(world.policy)],
    );
    for (const event of world.calendarSeed) {
      await client.query(
        'INSERT INTO dira_sim_calendar_events (account_id, event_id, title, start_iso, end_iso) VALUES ($1, $2, $3, $4, $5)',
        [accountId, event.id, event.title, event.startIso, event.endIso],
      );
    }
    for (const message of world.inboxSeed) {
      await client.query(
        `INSERT INTO dira_sim_messages (account_id, message_id, thread_id, folder, from_address, to_address, subject, body)
         VALUES ($1, $2, $3, 'INBOX', $4, $5, $6, $7)`,
        [accountId, message.messageId, message.threadId, message.from, message.to, message.subject, message.body],
      );
    }
    for (const task of world.orgSeed) {
      await client.query(
        'INSERT INTO dira_delegations (account_id, task_id, title, owner, due_iso) VALUES ($1, $2, $3, $4, $5)',
        [accountId, task.id, task.title, task.owner, task.dueIso],
      );
    }
    for (const slot of world.slots.slots) {
      await client.query(
        `INSERT INTO dira_sim_slots (account_id, commitment_id, slot_id, start_iso, end_iso, actually_available)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [accountId, world.slots.commitmentId, slot.slotId, slot.startIso, slot.endIso, slot.actuallyAvailable],
      );
    }
  });
  await store.pool.query(
    'INSERT INTO dira_demo_sessions (account_id, expires_at) VALUES ($1, $2) ON CONFLICT (account_id) DO UPDATE SET expires_at = EXCLUDED.expires_at',
    [accountId, expiresAt],
  );
}

/** Remove every tenant row for an account (cascade) under its own RLS context. */
export async function deleteAccountData(store: PostgresAccountStore, accountId: string): Promise<void> {
  await store.withAccount(accountId, async (client) => {
    await client.query('DELETE FROM dira_accounts WHERE account_id = $1', [accountId]);
  });
  await store.pool.query('DELETE FROM dira_demo_sessions WHERE account_id = $1', [accountId]);
}

export async function deleteExpiredDemoAccounts(store: PostgresAccountStore, now = new Date()): Promise<number> {
  const expired = await store.pool.query<{ account_id: string }>(
    'SELECT account_id FROM dira_demo_sessions WHERE expires_at < $1 ORDER BY expires_at LIMIT 200', [now],
  );
  for (const row of expired.rows) await deleteAccountData(store, row.account_id);
  return expired.rows.length;
}

export async function appendFlightRecords(
  store: PostgresAccountStore,
  accountId: string,
  workflowId: string,
  entries: readonly FlightEntry[],
): Promise<void> {
  if (!entries.length) return;
  await store.withAccount(accountId, async (client) => {
    const offset = await client.query<{ next: number }>(
      'SELECT COALESCE(MAX(seq), 0) AS next FROM dira_flight_records WHERE account_id = $1 AND workflow_id = $2',
      [accountId, workflowId],
    );
    let seq = Number(offset.rows[0]?.next ?? 0);
    for (const entry of entries) {
      seq += 1;
      await client.query(
        `INSERT INTO dira_flight_records (account_id, workflow_id, seq, recorded_at, phase, message, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [accountId, workflowId, seq, entry.atIso, entry.phase, entry.message.slice(0, 2000),
          entry.data === undefined ? null : JSON.stringify(entry.data)],
      );
    }
  });
}

export interface StoredFlightEntry { seq: number; atIso: string; phase: string; message: string; data?: unknown }

export async function listFlightRecords(store: PostgresAccountStore, accountId: string, workflowId: string): Promise<StoredFlightEntry[]> {
  return store.withAccount(accountId, async (client) => {
    const result = await client.query<{ seq: number; recorded_at: Date; phase: string; message: string; data: unknown }>(
      `SELECT seq, recorded_at, phase, message, data FROM dira_flight_records
       WHERE account_id = $1 AND workflow_id = $2 ORDER BY seq`,
      [accountId, workflowId],
    );
    return result.rows.map((row) => ({
      seq: row.seq, atIso: row.recorded_at.toISOString(), phase: row.phase, message: row.message,
      ...(row.data === null ? {} : { data: row.data }),
    }));
  });
}

export async function pruneFlightRecords(store: PostgresAccountStore, accountId: string, retentionDays: number): Promise<number> {
  if (retentionDays <= 0) return 0;
  return store.withAccount(accountId, async (client) => {
    const result = await client.query(
      `DELETE FROM dira_flight_records WHERE account_id = $1 AND recorded_at < now() - ($2::int * interval '1 day')`,
      [accountId, retentionDays],
    );
    return result.rowCount ?? 0;
  });
}

export async function listRecentWorkflows(store: PostgresAccountStore, accountId: string, limit = 20): Promise<WorkflowRun[]> {
  return store.withAccount(accountId, async (client) => {
    const result = await client.query<{ run: WorkflowRun }>(
      'SELECT run FROM dira_workflows WHERE account_id = $1 ORDER BY updated_at DESC LIMIT $2',
      [accountId, limit],
    );
    return result.rows.map((row) => row.run);
  });
}

/**
 * Record an owner decision on an event-repair action. Valid sources are an
 * authenticated web session or a nonce-checked Telegram callback. Execution
 * happens later, after the engine revalidates the plan against fresh state.
 */
export async function recordOwnerDecision(
  store: PostgresAccountStore,
  accountId: string,
  actionId: string,
  decision: 'APPROVED' | 'REJECTED',
  source: 'authenticated-web' | 'telegram-callback',
): Promise<ActionRecord> {
  return store.withAccount(accountId, async (client) => {
    const selected = await client.query<{ record: ActionRecord }>(
      'SELECT record FROM dira_action_ledger WHERE account_id = $1 AND action_id = $2 FOR UPDATE',
      [accountId, actionId],
    );
    const current = selected.rows[0]?.record;
    if (!current) throw new Error('approval action not found');
    if (current.status !== 'AWAITING_APPROVAL') throw new Error('action is no longer awaiting approval');
    if (current.policyVerdict !== 'REQUIRE_APPROVAL') throw new Error('action policy does not require approval');
    const now = new Date().toISOString();
    const status = decision === 'APPROVED' ? 'AUTHORIZED' : 'REJECTED';
    const record: ActionRecord = {
      ...current,
      status,
      approval: {
        ...current.approval,
        decision,
        decisionAtIso: now,
        actorAccountId: accountId,
        source,
      },
      history: [...current.history, {
        status, atIso: now,
        note: `${decision.toLowerCase()} by the account owner (${source}); execution requires fresh revalidation`,
      }],
    };
    await client.query(
      'UPDATE dira_action_ledger SET status = $3, record = $4::jsonb, updated_at = now() WHERE account_id = $1 AND action_id = $2',
      [accountId, actionId, status, JSON.stringify(record)],
    );
    await client.query(
      `INSERT INTO dira_action_approvals (account_id, action_id, decision, actor_account_id, source, decided_at)
       VALUES ($1, $2, $3, $1, $4, $5)
       ON CONFLICT (account_id, action_id) DO UPDATE SET decision = EXCLUDED.decision, source = EXCLUDED.source,
         decided_at = EXCLUDED.decided_at`,
      [accountId, actionId, decision, source, now],
    );
    return record;
  });
}

export async function recordEgressAttempt(
  store: PostgresAccountStore,
  accountId: string,
  attempt: { host: string; url: string; verdict: 'DENIED' | 'ALLOWED'; statusCode: number; purpose: string },
): Promise<void> {
  await store.withAccount(accountId, async (client) => {
    await client.query(
      `INSERT INTO dira_egress_audit (account_id, event_id, host, url, verdict, status_code, purpose)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [accountId, randomUUID(), attempt.host.slice(0, 255), attempt.url.slice(0, 500), attempt.verdict, attempt.statusCode, attempt.purpose.slice(0, 200)],
    );
  });
}

export async function listEgressAudit(store: PostgresAccountStore, accountId: string) {
  return store.withAccount(accountId, async (client) => {
    const result = await client.query<{ host: string; url: string; verdict: string; status_code: number; purpose: string; created_at: Date }>(
      `SELECT host, url, verdict, status_code, purpose, created_at FROM dira_egress_audit
       WHERE account_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [accountId],
    );
    return result.rows.map((row) => ({
      host: row.host, url: row.url, verdict: row.verdict, statusCode: row.status_code, purpose: row.purpose,
      createdAtIso: row.created_at.toISOString(),
    }));
  });
}

/** Everything a judge needs to see that the actions landed: fresh reads of each simulated or recorded surface. */
export async function readExecutionSurfaces(store: PostgresAccountStore, accountId: string) {
  return store.withAccount(accountId, async (client) => {
    // One connection, so the reads run sequentially inside the RLS transaction.
    const calendar = await client.query<{ event_id: string; title: string; start_iso: string; end_iso: string }>(
      'SELECT event_id, title, start_iso, end_iso FROM dira_sim_calendar_events WHERE account_id = $1 ORDER BY start_iso', [accountId]);
    const messages = await client.query<{ message_id: string; thread_id: string; folder: string; to_address: string; from_address: string; subject: string; body: string; created_at: Date }>(
      `SELECT message_id, thread_id, folder, to_address, from_address, subject, body, created_at FROM dira_sim_messages
       WHERE account_id = $1 ORDER BY created_at DESC`, [accountId]);
    const bookings = await client.query<{ commitment_id: string; start_iso: string; status: string; updated_at: Date }>(
      'SELECT commitment_id, start_iso, status, updated_at FROM dira_bookings WHERE account_id = $1', [accountId]);
    const delegations = await client.query<{ task_id: string; title: string; owner: string; updated_at: Date }>(
      'SELECT task_id, title, owner, updated_at FROM dira_delegations WHERE account_id = $1', [accountId]);
    return {
      calendar: calendar.rows.map((row) => ({ id: row.event_id, title: row.title, startIso: row.start_iso, endIso: row.end_iso })),
      messages: messages.rows.map((row) => ({
        id: row.message_id, threadId: row.thread_id, folder: row.folder, to: row.to_address, from: row.from_address,
        subject: row.subject, body: row.body, createdAtIso: row.created_at.toISOString(),
      })),
      bookings: bookings.rows.map((row) => ({ commitmentId: row.commitment_id, startIso: row.start_iso, status: row.status, updatedAtIso: row.updated_at.toISOString() })),
      delegations: delegations.rows.map((row) => ({ taskId: row.task_id, title: row.title, owner: row.owner, updatedAtIso: row.updated_at.toISOString() })),
    };
  });
}

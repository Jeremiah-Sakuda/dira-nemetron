import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import type { DomainState } from '@dira/commitment-model';
import type { ActionRecord, LedgerStore } from '@dira/action-ledger';
import type { WorkflowRun, WorkflowStore } from '@dira/agent';

export interface DiraAccount {
  accountId: string;
  email: string;
  timezone: string;
}

export interface EncryptedCredential {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
  scopes: string[];
  expiresAt?: Date;
}

export interface EventClaimInput {
  eventId: string;
  payload: unknown;
  now?: Date;
  leaseMs?: number;
}

export type EventClaim = 'CLAIMED' | 'COMPLETED' | 'PROCESSING';

/** PostgreSQL persistence with transaction-local tenant context and RLS. */
export class PostgresAccountStore {
  readonly pool: Pool;

  constructor(pool = createPostgresPool()) {
    this.pool = pool;
  }

  async initialize(): Promise<void> {
    for (const name of ['001_account_state.sql', '002_google_credentials.sql']) {
      const migration = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
      await this.pool.query(migration);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async saveAccount(account: DiraAccount): Promise<void> {
    if (!account.accountId || !account.email || !account.timezone) {
      throw new Error('account id, email, and timezone are required');
    }
    await this.withAccount(account.accountId, async (client) => {
      await client.query(
        `INSERT INTO dira_accounts (account_id, email, timezone)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id) DO UPDATE
         SET email = EXCLUDED.email, timezone = EXCLUDED.timezone, updated_at = now()`,
        [account.accountId, account.email.toLowerCase(), account.timezone],
      );
    });
  }

  async getAccount(accountId: string): Promise<DiraAccount | undefined> {
    return this.withAccount(accountId, async (client) => {
      const result = await client.query<{ account_id: string; email: string; timezone: string }>(
        'SELECT account_id, email, timezone FROM dira_accounts WHERE account_id = $1',
        [accountId],
      );
      const row = result.rows[0];
      return row ? { accountId: row.account_id, email: row.email, timezone: row.timezone } : undefined;
    });
  }

  async saveCredential(accountId: string, provider: string, credential: EncryptedCredential): Promise<void> {
    await this.withAccount(accountId, async (client) => {
      await client.query(
        `INSERT INTO dira_credentials
           (account_id, provider, ciphertext, iv, auth_tag, key_version, scopes, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (account_id, provider) DO UPDATE SET
           ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv, auth_tag = EXCLUDED.auth_tag,
           key_version = EXCLUDED.key_version, scopes = EXCLUDED.scopes,
           expires_at = EXCLUDED.expires_at, updated_at = now()`,
        [accountId, provider, credential.ciphertext, credential.iv, credential.authTag,
          credential.keyVersion, credential.scopes, credential.expiresAt ?? null],
      );
    });
  }

  async getCredential(accountId: string, provider: string): Promise<EncryptedCredential | undefined> {
    return this.withAccount(accountId, async (client) => {
      const result = await client.query<{
        ciphertext: string; iv: string; auth_tag: string; key_version: number;
        scopes: string[]; expires_at: Date | null;
      }>(
        `SELECT ciphertext, iv, auth_tag, key_version, scopes, expires_at
         FROM dira_credentials WHERE account_id = $1 AND provider = $2`,
        [accountId, provider],
      );
      const row = result.rows[0];
      return row ? {
        ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag,
        keyVersion: row.key_version, scopes: row.scopes,
        expiresAt: row.expires_at ?? undefined,
      } : undefined;
    });
  }

  async saveDomainState(accountId: string, state: DomainState): Promise<void> {
    assertAccountMatch(accountId, state.userId);
    await this.withAccount(accountId, async (client) => {
      await client.query(
        `INSERT INTO dira_account_state (account_id, state)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (account_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
        [accountId, JSON.stringify({ ...state, timezone: state.timezone ?? (await loadTimezone(client, accountId)) })],
      );
    });
  }

  async loadDomainState(accountId: string): Promise<DomainState | null> {
    return this.withAccount(accountId, async (client) => {
      const result = await client.query<{ state: DomainState }>(
        'SELECT state FROM dira_account_state WHERE account_id = $1',
        [accountId],
      );
      const state = result.rows[0]?.state;
      if (!state) return null;
      assertAccountMatch(accountId, state.userId);
      return state;
    });
  }

  async claimEvent(accountId: string, input: EventClaimInput): Promise<EventClaim> {
    const now = input.now ?? new Date();
    const leaseUntil = new Date(now.getTime() + (input.leaseMs ?? 5 * 60_000));
    return this.withAccount(accountId, async (client) => {
      const inserted = await client.query(
        `INSERT INTO dira_events (account_id, event_id, status, claimed_at, lease_until, attempts, payload)
         VALUES ($1, $2, 'PROCESSING', $3, $4, 1, $5::jsonb)
         ON CONFLICT (account_id, event_id) DO UPDATE
         SET status = 'PROCESSING', claimed_at = EXCLUDED.claimed_at,
             lease_until = EXCLUDED.lease_until, attempts = dira_events.attempts + 1,
             payload = EXCLUDED.payload, failure = NULL, updated_at = now()
         WHERE dira_events.status = 'FAILED' OR dira_events.lease_until < $3
         RETURNING event_id`,
        [accountId, input.eventId, now, leaseUntil, JSON.stringify(input.payload)],
      );
      if (inserted.rowCount) return 'CLAIMED';
      const prior = await client.query<{ status: string }>(
        'SELECT status FROM dira_events WHERE account_id = $1 AND event_id = $2',
        [accountId, input.eventId],
      );
      return prior.rows[0]?.status === 'COMPLETED' ? 'COMPLETED' : 'PROCESSING';
    });
  }

  async finishEvent(
    accountId: string,
    eventId: string,
    update: { status: 'COMPLETED' | 'FAILED'; workflowId?: string; failure?: string },
  ): Promise<void> {
    await this.withAccount(accountId, async (client) => {
      await client.query(
        `UPDATE dira_events SET status = $3, workflow_id = $4, failure = $5,
                lease_until = NULL, updated_at = now()
         WHERE account_id = $1 AND event_id = $2`,
        [accountId, eventId, update.status, update.workflowId ?? null, update.failure ?? null],
      );
    });
  }

  async withAccount<T>(accountId: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!accountId) throw new Error('accountId is required for account-scoped database access');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('dira.account_id', $1, true)", [accountId]);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PostgresWorkflowStore implements WorkflowStore {
  constructor(private readonly store: PostgresAccountStore, private readonly accountId: string) {}

  async get(id: string): Promise<WorkflowRun | undefined> {
    return this.store.withAccount(this.accountId, async (client) => {
      const result = await client.query<{ run: WorkflowRun }>(
        'SELECT run FROM dira_workflows WHERE account_id = $1 AND workflow_id = $2',
        [this.accountId, id],
      );
      return result.rows[0]?.run;
    });
  }

  async save(run: WorkflowRun): Promise<void> {
    return this.store.withAccount(this.accountId, async (client) => {
      await client.query(
        `INSERT INTO dira_workflows (account_id, workflow_id, run)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (account_id, workflow_id) DO UPDATE
         SET run = EXCLUDED.run, updated_at = now()`,
        [this.accountId, run.id, JSON.stringify(run)],
      );
    });
  }
}

/** Storage adapter used by the single-process ActionLedger implementation. */
export class PostgresLedgerStore implements LedgerStore {
  constructor(private readonly store: PostgresAccountStore, private readonly accountId: string) {}

  async load(): Promise<ActionRecord[]> {
    return this.store.withAccount(this.accountId, async (client) => {
      const result = await client.query<{ record: ActionRecord }>(
        'SELECT record FROM dira_action_ledger WHERE account_id = $1 ORDER BY record_index',
        [this.accountId],
      );
      return result.rows.map((row) => row.record);
    });
  }

  async save(records: ActionRecord[]): Promise<void> {
    return this.store.withAccount(this.accountId, async (client) => {
      await client.query('DELETE FROM dira_action_ledger WHERE account_id = $1', [this.accountId]);
      for (const [recordIndex, record] of records.entries()) {
        await client.query(
          `INSERT INTO dira_action_ledger
             (account_id, record_index, action_id, workflow_id, idempotency_key, status, record)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [this.accountId, recordIndex, record.actionId, record.workflowId,
            record.idempotencyKey, record.status, JSON.stringify(record)],
        );
      }
    });
  }
}

function createPostgresPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL persistence');
  return new Pool({
    connectionString,
    max: Number(process.env.DIRA_DATABASE_POOL_SIZE ?? 10),
    ssl: process.env.DIRA_DATABASE_SSL === 'true'
      ? { rejectUnauthorized: process.env.DIRA_DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
      : undefined,
  });
}

function assertAccountMatch(accountId: string, userId: string): void {
  if (accountId !== userId) throw new Error(`account ${accountId} cannot access state for ${userId}`);
}

async function loadTimezone(client: PoolClient, accountId: string): Promise<string> {
  const result = await client.query<{ timezone: string }>(
    'SELECT timezone FROM dira_accounts WHERE account_id = $1',
    [accountId],
  );
  return result.rows[0]?.timezone ?? 'UTC';
}

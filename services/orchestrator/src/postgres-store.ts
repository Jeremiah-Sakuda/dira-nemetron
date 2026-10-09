import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { DEFAULT_ENGINE_CONFIG, isoToMinutes, localDateTimeToIso, type Commitment, type DomainState } from '@dira/commitment-model';
import type { ActionRecord, LedgerStore } from '@dira/action-ledger';
import type { WorkflowRun, WorkflowStore } from '@dira/agent';
import type { CalendarCommitmentDraft, GraphEdgeDataEditsInput, GraphEdgeDraft, GraphProposalEditsInput } from '@dira/agent';
import type { AvailabilityProfile } from './account-planning.js';
import { AccountPolicySettingsSchema, DEFAULT_ACCOUNT_POLICY, type AccountPolicySettings } from './account-policy.js';
import { availabilityIntervals, rebaseDomainState } from './account-planning.js';

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

export interface AccountPlanningSnapshot {
  state: DomainState;
  stateVersion: string;
  profile: AvailabilityProfile;
  profileVersion: string;
  policy: AccountPolicySettings;
  policyVersion: string;
}

export interface ApprovalRevalidationEvidence {
  revalidatedAtIso: string;
  evidenceHash: string;
  stateVersion: string;
  profileVersion: string;
  policyVersion: string;
}

export interface PolicyBlockEvent {
  eventId: string;
  actionType: string;
  targetId: string;
  policyRule: string;
  reason: string;
  createdAtIso: string;
}

export interface EventClaimInput {
  eventId: string;
  payload: unknown;
  now?: Date;
  leaseMs?: number;
}

export type EventClaim = 'CLAIMED' | 'COMPLETED' | 'PROCESSING';

export interface StoredGraphProposal {
  proposalId: string;
  sourceId: string;
  sourceType: 'google-calendar';
  status: 'PENDING_REVIEW' | 'CONFIRMED' | 'REJECTED' | 'IGNORED';
  source: {
    id: string; title: string; startIso: string; endIso: string; version?: string; etag?: string;
    changeType?: 'NEW' | 'UPDATED' | 'CANCELLED';
    previous?: { title: string; startIso: string; endIso: string };
  };
  draft: CalendarCommitmentDraft;
  model: Record<string, unknown>;
}

export interface GraphProposalInput {
  source: StoredGraphProposal['source'];
  draft: CalendarCommitmentDraft;
  model: Record<string, unknown>;
}

export interface StoredGraphEdgeProposal extends GraphEdgeDraft {
  proposalId: string;
  status: 'PENDING_REVIEW' | 'CONFIRMED' | 'REJECTED';
  model: Record<string, unknown>;
  fromTitle: string;
  toTitle: string;
}

/** PostgreSQL persistence with transaction-local tenant context and RLS. */
export class PostgresAccountStore {
  readonly pool: Pool;

  constructor(pool = createPostgresPool()) {
    this.pool = pool;
  }

  async initialize(): Promise<void> {
    for (const name of [
      '001_account_state.sql', '002_google_credentials.sql',
      '003_graph_proposals.sql', '004_graph_edge_proposals.sql',
      '005_account_availability.sql', '006_action_approvals.sql', '007_action_ledger_identity.sql',
      '008_workflow_execution_evidence.sql', '009_account_policy_settings.sql',
      '010_policy_block_events.sql', '011_source_sync_cursors.sql',
    ]) {
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

  async getSourceSyncCursor(accountId: string, source: 'google-calendar' | 'gmail'): Promise<string | undefined> {
    return this.withAccount(accountId, async (client) => {
      const result = await client.query<{ cursor: string }>(
        'SELECT cursor FROM dira_source_sync_cursors WHERE account_id = $1 AND source = $2',
        [accountId, source],
      );
      return result.rows[0]?.cursor;
    });
  }

  async saveSourceSyncCursor(accountId: string, source: 'google-calendar' | 'gmail', cursor: string): Promise<void> {
    if (!cursor || cursor.length > 4096) throw new Error('invalid source sync cursor');
    await this.withAccount(accountId, async (client) => {
      await client.query(
        `INSERT INTO dira_source_sync_cursors (account_id, source, cursor) VALUES ($1, $2, $3)
         ON CONFLICT (account_id, source) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = now()`,
        [accountId, source, cursor],
      );
    });
  }

  async withAdvisoryJobLock<T>(
    accountId: string,
    job: string,
    operation: () => Promise<T>,
  ): Promise<{ acquired: true; value: T } | { acquired: false }> {
    const client = await this.pool.connect();
    let acquired = false;
    try {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked',
        [accountId, job],
      );
      acquired = result.rows[0]?.locked === true;
      if (!acquired) return { acquired: false };
      return { acquired: true, value: await operation() };
    } finally {
      if (acquired) {
        await client.query('SELECT pg_advisory_unlock(hashtext($1), hashtext($2))', [accountId, job]).catch(() => undefined);
      }
      client.release();
    }
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

  async ensureDomainState(accountId: string): Promise<DomainState> {
    return this.withAccount(accountId, async (client) => {
      const existing = await client.query<{ state: DomainState }>(
        'SELECT state FROM dira_account_state WHERE account_id = $1',
        [accountId],
      );
      if (existing.rows[0]?.state) {
        assertAccountMatch(accountId, existing.rows[0].state.userId);
        return existing.rows[0].state;
      }
      const timezone = await loadTimezone(client, accountId);
      const state = createEmptyDomainState(accountId, timezone);
      await client.query(
        `INSERT INTO dira_account_state (account_id, state) VALUES ($1, $2::jsonb)
         ON CONFLICT (account_id) DO NOTHING`,
        [accountId, JSON.stringify(state)],
      );
      const saved = await client.query<{ state: DomainState }>(
        'SELECT state FROM dira_account_state WHERE account_id = $1',
        [accountId],
      );
      const result = saved.rows[0]?.state;
      if (!result) throw new Error('failed to initialize account state');
      assertAccountMatch(accountId, result.userId);
      return result;
    });
  }

  async getAvailabilityProfile(accountId: string): Promise<AvailabilityProfile | undefined> {
    return this.withAccount(accountId, async (client) => {
      const result = await client.query<{ profile: AvailabilityProfile }>(
        'SELECT profile FROM dira_availability_profiles WHERE account_id = $1',
        [accountId],
      );
      return result.rows[0]?.profile;
    });
  }

  async getAccountPolicySettings(accountId: string): Promise<AccountPolicySettings> {
    return this.withAccount(accountId, async (client) => {
      await client.query(
        `INSERT INTO dira_account_policy_settings (account_id, policy) VALUES ($1, $2::jsonb)
         ON CONFLICT (account_id) DO NOTHING`,
        [accountId, JSON.stringify(DEFAULT_ACCOUNT_POLICY)],
      );
      const result = await client.query<{ policy: unknown }>(
        'SELECT policy FROM dira_account_policy_settings WHERE account_id = $1',
        [accountId],
      );
      if (!result.rows[0]) return structuredClone(DEFAULT_ACCOUNT_POLICY);
      return AccountPolicySettingsSchema.parse(result.rows[0].policy);
    });
  }

  async saveAccountPolicySettings(accountId: string, input: unknown): Promise<AccountPolicySettings> {
    const policy = AccountPolicySettingsSchema.parse(input);
    return this.withAccount(accountId, async (client) => {
      await client.query(
        `INSERT INTO dira_account_policy_settings (account_id, policy) VALUES ($1, $2::jsonb)
         ON CONFLICT (account_id) DO UPDATE SET policy = EXCLUDED.policy, updated_at = now()`,
        [accountId, JSON.stringify(policy)],
      );
      return policy;
    });
  }

  async recordPolicyBlock(accountId: string, event: Omit<PolicyBlockEvent, 'eventId' | 'createdAtIso'>): Promise<void> {
    const actionType = event.actionType.slice(0, 80);
    const targetId = event.targetId.slice(0, 256);
    const policyRule = event.policyRule.slice(0, 120);
    const reason = event.reason.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 500);
    if (!actionType || !targetId || !policyRule || !reason) throw new Error('invalid policy block event');
    await this.withAccount(accountId, async (client) => {
      await client.query(
        `INSERT INTO dira_policy_block_events (account_id, event_id, action_type, target_id, policy_rule, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [accountId, randomUUID(), actionType, targetId, policyRule, reason],
      );
    });
  }

  async listPolicyBlockEvents(accountId: string): Promise<PolicyBlockEvent[]> {
    return this.withAccount(accountId, async (client) => {
      const result = await client.query<{
        event_id: string; action_type: string; target_id: string; policy_rule: string;
        reason: string; created_at: Date;
      }>(
        `SELECT event_id, action_type, target_id, policy_rule, reason, created_at
         FROM dira_policy_block_events WHERE account_id = $1
         ORDER BY created_at DESC LIMIT 50`,
        [accountId],
      );
      return result.rows.map((row) => ({
        eventId: row.event_id,
        actionType: row.action_type,
        targetId: row.target_id,
        policyRule: row.policy_rule,
        reason: row.reason,
        createdAtIso: row.created_at.toISOString(),
      }));
    });
  }

  async loadAccountPlanningSnapshot(accountId: string): Promise<AccountPlanningSnapshot | undefined> {
    return this.withAccount(accountId, async (client) => {
      await client.query(
        `INSERT INTO dira_account_policy_settings (account_id, policy) VALUES ($1, $2::jsonb)
         ON CONFLICT (account_id) DO NOTHING`,
        [accountId, JSON.stringify(DEFAULT_ACCOUNT_POLICY)],
      );
      const result = await client.query<{
        state: DomainState; profile: AvailabilityProfile; policy: AccountPolicySettings | null;
      }>(
        `SELECT s.state, p.profile, ps.policy
         FROM dira_account_state s
         JOIN dira_availability_profiles p USING (account_id)
         LEFT JOIN dira_account_policy_settings ps USING (account_id)
         WHERE s.account_id = $1`,
        [accountId],
      );
      const snapshot = result.rows[0];
      if (!snapshot) return undefined;
      assertAccountMatch(accountId, snapshot.state.userId);
      return {
        state: snapshot.state,
        stateVersion: contentHash(snapshot.state),
        profile: snapshot.profile,
        profileVersion: contentHash(snapshot.profile),
        policy: snapshot.policy ? AccountPolicySettingsSchema.parse(snapshot.policy) : structuredClone(DEFAULT_ACCOUNT_POLICY),
        policyVersion: contentHash(snapshot.policy ? AccountPolicySettingsSchema.parse(snapshot.policy) : DEFAULT_ACCOUNT_POLICY),
      };
    });
  }

  async saveAvailabilityProfile(
    accountId: string,
    profile: AvailabilityProfile,
    now = new Date(),
  ): Promise<void> {
    await this.withAccount(accountId, async (client) => {
      const stateResult = await client.query<{ state: DomainState }>(
        'SELECT state FROM dira_account_state WHERE account_id = $1 FOR UPDATE',
        [accountId],
      );
      const state = stateResult.rows[0]?.state;
      if (!state) throw new Error('account state is not initialized');
      assertAccountMatch(accountId, state.userId);
      const rebased = rebaseDomainState(state, now);
      rebased.availability = availabilityIntervals(profile, rebased, now);
      await client.query(
        'UPDATE dira_account_state SET state = $2::jsonb, updated_at = now() WHERE account_id = $1',
        [accountId, JSON.stringify(rebased)],
      );
      await client.query(
        `INSERT INTO dira_availability_profiles (account_id, profile)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (account_id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = now()`,
        [accountId, JSON.stringify(profile)],
      );
    });
  }

  async restoreAccountMemory(
    accountId: string,
    state: DomainState,
    profile: AvailabilityProfile | undefined,
    policy: AccountPolicySettings,
    now = new Date(),
  ): Promise<void> {
    assertAccountMatch(accountId, state.userId);
    const validatedPolicy = AccountPolicySettingsSchema.parse(policy);
    await this.withAccount(accountId, async (client) => {
      const current = await client.query<{ state: DomainState }>(
        'SELECT state FROM dira_account_state WHERE account_id = $1 FOR UPDATE',
        [accountId],
      );
      if (!current.rows[0]) throw new Error('account state is not initialized');
      assertAccountMatch(accountId, current.rows[0].state.userId);

      const activeActions = await client.query<{ action_id: string }>(
        `SELECT action_id FROM dira_action_ledger WHERE account_id = $1
         AND status IN ('AWAITING_APPROVAL', 'AUTHORIZED', 'PENDING_EXECUTION', 'EXECUTING',
           'EXECUTED_UNVERIFIED', 'FAILED_TRANSIENT') FOR UPDATE`,
        [accountId],
      );
      if (activeActions.rows.length) throw new Error('Resolve or cancel pending actions before restoring memory.');
      const activeWorkflows = await client.query<{ workflow_id: string }>(
        `SELECT workflow_id FROM dira_workflows WHERE account_id = $1
         AND run->>'status' IN ('WAITING_REVIEW', 'RUNNING') FOR UPDATE`,
        [accountId],
      );
      if (activeWorkflows.rows.length) throw new Error('Wait for active workflows to finish before restoring memory.');

      const timezone = await loadTimezone(client, accountId);
      if ((state.timezone ?? 'UTC') !== timezone) {
        throw new Error('The memory timezone differs from this account. Reconnect the matching Google account before restoring.');
      }
      const restored = rebaseDomainState({ ...state, timezone }, now);
      restored.userId = accountId;
      restored.availability = profile ? availabilityIntervals(profile, restored, now) : [];
      await client.query(
        `UPDATE dira_account_state SET state = $2::jsonb, updated_at = now() WHERE account_id = $1`,
        [accountId, JSON.stringify(restored)],
      );
      if (profile) {
        await client.query(
          `INSERT INTO dira_availability_profiles (account_id, profile)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (account_id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = now()`,
          [accountId, JSON.stringify(profile)],
        );
      } else {
        await client.query('DELETE FROM dira_availability_profiles WHERE account_id = $1', [accountId]);
      }
      await client.query(
        `INSERT INTO dira_account_policy_settings (account_id, policy)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (account_id) DO UPDATE SET policy = EXCLUDED.policy, updated_at = now()`,
        [accountId, JSON.stringify(validatedPolicy)],
      );
      await client.query(
        `UPDATE dira_graph_proposals SET status = 'IGNORED', decided_at = now(), updated_at = now()
         WHERE account_id = $1 AND status = 'PENDING_REVIEW'`,
        [accountId],
      );
      await client.query(
        `UPDATE dira_graph_edge_proposals SET status = 'REJECTED', decided_at = now(), updated_at = now()
         WHERE account_id = $1 AND status = 'PENDING_REVIEW'`,
        [accountId],
      );
    });
  }

  async listPendingApprovals(accountId: string): Promise<ActionRecord[]> {
    return this.withAccount(accountId, async (client) => {
      const result = await client.query<{ record: ActionRecord }>(
        `SELECT record FROM dira_action_ledger
         WHERE account_id = $1 AND status = 'AWAITING_APPROVAL'
         ORDER BY updated_at ASC, record_index ASC`,
        [accountId],
      );
      return result.rows.map((row) => row.record);
    });
  }

  async listResumableApprovalWorkflows(accountId: string): Promise<{ workflowId: string; label: string }[]> {
    return this.withAccount(accountId, async (client) => {
      const result = await client.query<{ workflow_id: string; label: string }>(
        `SELECT w.workflow_id, COALESCE(w.run->>'mutationSummary', 'Approved plan') AS label
         FROM dira_workflows w
         WHERE w.account_id = $1 AND w.run->>'status' IN ('WAITING_REVIEW', 'RUNNING')
           AND EXISTS (
             SELECT 1 FROM dira_action_ledger l
             WHERE l.account_id = w.account_id AND l.workflow_id = w.workflow_id
               AND l.status IN ('AUTHORIZED', 'PENDING_EXECUTION', 'EXECUTING', 'EXECUTED_UNVERIFIED', 'FAILED_TRANSIENT', 'VERIFIED')
           )
           AND NOT EXISTS (
             SELECT 1 FROM dira_action_ledger l
             WHERE l.account_id = w.account_id AND l.workflow_id = w.workflow_id
               AND l.status IN ('AWAITING_APPROVAL', 'REJECTED', 'STALE', 'REPLAN_REQUIRED', 'FAILED_PERMANENT')
           )
         ORDER BY w.updated_at DESC`,
        [accountId],
      );
      return result.rows.map((row) => ({ workflowId: row.workflow_id, label: row.label }));
    });
  }

  async getActionRecord(accountId: string, actionId: string): Promise<ActionRecord | undefined> {
    return this.withAccount(accountId, async (client) => {
      const result = await client.query<{ record: ActionRecord }>(
        'SELECT record FROM dira_action_ledger WHERE account_id = $1 AND action_id = $2',
        [accountId, actionId],
      );
      return result.rows[0]?.record;
    });
  }

  async listWorkflowActionRecords(accountId: string, workflowId: string): Promise<ActionRecord[]> {
    return this.withAccount(accountId, async (client) => {
      const result = await client.query<{ record: ActionRecord }>(
        `SELECT record FROM dira_action_ledger
         WHERE account_id = $1 AND workflow_id = $2
         ORDER BY record_index ASC`,
        [accountId, workflowId],
      );
      return result.rows.map((row) => row.record);
    });
  }

  /** Serialize one workflow's external mutations across service instances. */
  async withWorkflowExecutionLock<T>(accountId: string, workflowId: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!accountId || !workflowId) throw new Error('account and workflow ids are required');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('dira.account_id', $1, true)", [accountId]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [accountId, workflowId]);
      const state = await client.query('SELECT account_id FROM dira_account_state WHERE account_id = $1 FOR UPDATE', [accountId]);
      const profile = await client.query('SELECT account_id FROM dira_availability_profiles WHERE account_id = $1 FOR UPDATE', [accountId]);
      if (!state.rowCount || !profile.rowCount) throw new Error('account graph and focus hours must exist before workflow resumption');
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

  /** Persist resume-time deterministic revalidation before the first external write. */
  async recordWorkflowExecutionEvidence(
    accountId: string,
    workflowId: string,
    evidence: ApprovalRevalidationEvidence,
    transactionClient?: PoolClient,
  ): Promise<void> {
    const operation = async (client: PoolClient) => {
      const [stateResult, profileResult] = await Promise.all([
        client.query<{ state: DomainState }>('SELECT state FROM dira_account_state WHERE account_id = $1', [accountId]),
        client.query<{ profile: AvailabilityProfile }>('SELECT profile FROM dira_availability_profiles WHERE account_id = $1', [accountId]),
      ]);
      if (!stateResult.rows[0] || !profileResult.rows[0]
        || contentHash(stateResult.rows[0].state) !== evidence.stateVersion
        || contentHash(profileResult.rows[0].profile) !== evidence.profileVersion) {
        throw new Error('account graph or focus hours changed during workflow resumption; refresh the plan');
      }
      const recordsResult = await client.query<{ status: ActionRecord['status'] }>(
        'SELECT status FROM dira_action_ledger WHERE account_id = $1 AND workflow_id = $2',
        [accountId, workflowId],
      );
      if (recordsResult.rows.length === 0 || recordsResult.rows.some((row) => !['AUTHORIZED', 'FAILED_TRANSIENT', 'PENDING_EXECUTION'].includes(row.status))) {
        throw new Error('every action in this workflow must be authorized and not externally in progress before revalidation');
      }
      await client.query(
        `INSERT INTO dira_workflow_execution_evidence (account_id, workflow_id, evidence)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (account_id, workflow_id) DO UPDATE SET evidence = EXCLUDED.evidence, updated_at = now()`,
        [accountId, workflowId, JSON.stringify(evidence)],
      );
    };
    if (transactionClient) return operation(transactionClient);
    await this.withAccount(accountId, operation);
  }

  async invalidateWorkflowActionsForReplan(accountId: string, workflowId: string, reason: string): Promise<void> {
    await this.withAccount(accountId, async (client) => {
      const rows = await client.query<{ action_id: string; status: ActionRecord['status']; record: ActionRecord }>(
        `SELECT action_id, status, record FROM dira_action_ledger
         WHERE account_id = $1 AND workflow_id = $2
           AND status IN ('AUTHORIZED', 'PENDING_EXECUTION', 'EXECUTING', 'EXECUTED_UNVERIFIED', 'FAILED_TRANSIENT') FOR UPDATE`,
        [accountId, workflowId],
      );
      const now = new Date().toISOString();
      for (const row of rows.rows) {
        const nextStatus: ActionRecord['status'] = ['EXECUTING', 'EXECUTED_UNVERIFIED', 'FAILED_TRANSIENT'].includes(row.status)
          ? 'REPLAN_REQUIRED' : 'STALE';
        const stale: ActionRecord = {
          ...row.record,
          status: nextStatus,
          failureReason: reason,
          history: [...row.record.history, { status: nextStatus, atIso: now, note: reason }],
        };
        await client.query(
          'UPDATE dira_action_ledger SET status = $3, record = $4::jsonb, updated_at = now() WHERE account_id = $1 AND action_id = $2',
          [accountId, row.action_id, nextStatus, JSON.stringify(stale)],
        );
      }
    });
  }

  async getWorkflowExecutionEvidence(accountId: string, workflowId: string): Promise<ApprovalRevalidationEvidence | undefined> {
    return this.withAccount(accountId, async (client) => {
      const result = await client.query<{ evidence: ApprovalRevalidationEvidence }>(
        'SELECT evidence FROM dira_workflow_execution_evidence WHERE account_id = $1 AND workflow_id = $2',
        [accountId, workflowId],
      );
      return result.rows[0]?.evidence;
    });
  }

  /** Commit the verified Calendar result to the account graph after the full plan succeeds. */
  async applyVerifiedCalendarActions(
    accountId: string,
    records: ActionRecord[],
    evidence: ApprovalRevalidationEvidence,
    transactionClient?: PoolClient,
  ): Promise<void> {
    const operation = async (client: PoolClient) => {
      const [stateResult, profileResult] = await Promise.all([
        client.query<{ state: DomainState }>('SELECT state FROM dira_account_state WHERE account_id = $1 FOR UPDATE', [accountId]),
        client.query<{ profile: AvailabilityProfile }>('SELECT profile FROM dira_availability_profiles WHERE account_id = $1 FOR SHARE', [accountId]),
      ]);
      const state = stateResult.rows[0]?.state;
      const profile = profileResult.rows[0]?.profile;
      if (!state || !profile || contentHash(state) !== evidence.stateVersion) {
        throw new Error('account graph changed before the verified plan could be committed');
      }
      assertAccountMatch(accountId, state.userId);
      const nowIso = new Date().toISOString();
      for (const record of records) {
        if (record.status !== 'VERIFIED' || record.action.external_system !== 'calendar') {
          throw new Error('only verified Calendar actions can update the account graph');
        }
        const action = record.action;
        const desired = action.desired_state as Record<string, unknown>;
        const startIso = typeof desired.start_iso === 'string' ? desired.start_iso : undefined;
        const endIso = typeof desired.end_iso === 'string' ? desired.end_iso : undefined;
        const startMin = startIso ? isoToMinutes(startIso, state.horizonStartIso) : undefined;
        const endMin = endIso ? isoToMinutes(endIso, state.horizonStartIso) : undefined;
        if ((action.type === 'MOVE_CALENDAR_EVENT' || action.type === 'CREATE_CALENDAR_EVENT')
          && (startMin === undefined || endMin === undefined || endMin <= startMin)) {
          throw new Error(`verified Calendar action ${record.actionId} has invalid absolute times`);
        }

        if (action.type === 'MOVE_CALENDAR_EVENT') {
          const commitment = state.commitments[action.target];
          if (!commitment) throw new Error(`Calendar move target ${action.target} is no longer in the account graph`);
          commitment.startMin = startMin;
          commitment.durationMin = endMin! - startMin!;
          commitment.updatedAtIso = nowIso;
        } else if (action.type === 'CREATE_CALENDAR_EVENT') {
          const title = typeof desired.title === 'string' ? desired.title : action.summary;
          const relatedId = typeof desired.reserves_effort_for === 'string' ? desired.reserves_effort_for : undefined;
          const related = relatedId ? state.commitments[relatedId] : undefined;
          const externalResponse = record.externalResponse as { id?: unknown; metadata?: { googleEventId?: unknown } } | undefined;
          const googleEventId = typeof externalResponse?.id === 'string'
            ? externalResponse.id
            : typeof externalResponse?.metadata?.googleEventId === 'string'
              ? externalResponse.metadata.googleEventId : undefined;
          if (!googleEventId) throw new Error(`verified Calendar event id is missing for ${record.actionId}`);
          const graphId = `cal-${googleEventId}`;
          const existing = state.commitments[graphId];
          if (existing) {
            if (existing.title !== title || existing.startMin !== startMin || existing.durationMin !== endMin! - startMin!) {
              throw new Error(`Calendar reservation id ${graphId} conflicts with an existing commitment`);
            }
            existing.status = 'PLANNED';
            existing.externalId = googleEventId;
            existing.updatedAtIso = nowIso;
          } else {
            const commitment: Commitment = {
              id: graphId,
              userId: accountId,
              title,
              domain: related?.domain ?? 'personal',
              source: 'dira-calendar-action',
              sourceReference: record.actionId,
              status: 'PLANNED',
              kind: relatedId ? 'block' : 'event',
              startMin,
              durationMin: endMin! - startMin!,
              ...(relatedId ? { reservesEffortFor: relatedId } : {}),
              flexibility: relatedId ? 'FLEXIBLE' : 'FIXED',
              criticality: 'NORMAL',
              owner: accountId,
              participants: [],
              goalIds: [],
              resourceRequirements: [],
              externalSystem: 'calendar',
              ...(googleEventId ? { externalId: googleEventId } : {}),
              confidence: 1,
              createdAtIso: nowIso,
              updatedAtIso: nowIso,
            };
            state.commitments[graphId] = commitment;
          }
        } else if (action.type === 'DELETE_CALENDAR_EVENT') {
          const commitment = state.commitments[action.target];
          if (!commitment) throw new Error(`Calendar delete target ${action.target} is no longer in the account graph`);
          commitment.status = 'DROPPED';
          commitment.updatedAtIso = nowIso;
        } else {
          throw new Error(`unsupported Calendar action ${action.type}`);
        }
      }
      await client.query('UPDATE dira_account_state SET state = $2::jsonb, updated_at = now() WHERE account_id = $1', [accountId, JSON.stringify(state)]);
    };
    if (transactionClient) return operation(transactionClient);
    await this.withAccount(accountId, operation);
  }

  async listRecentApprovalDecisions(accountId: string): Promise<{
    actionId: string; decision: 'APPROVED' | 'REJECTED'; decidedAtIso: string; revalidatedAtIso: string | null;
    evidenceHash: string | null; summary: string; status: ActionRecord['status'] | null;
  }[]> {
    return this.withAccount(accountId, async (client) => {
      const result = await client.query<{
        action_id: string; decision: 'APPROVED' | 'REJECTED'; decided_at: Date; revalidated_at: Date | null; evidence_hash: string | null;
        record: ActionRecord | null;
      }>(
        `SELECT a.action_id, a.decision, a.decided_at, a.revalidated_at, a.evidence_hash, l.record
         FROM dira_action_approvals a
         LEFT JOIN dira_action_ledger l
           ON l.account_id = a.account_id AND l.action_id = a.action_id
         WHERE a.account_id = $1
         ORDER BY a.decided_at DESC
         LIMIT 50`,
        [accountId],
      );
      return result.rows.map((row) => ({
        actionId: row.action_id,
        decision: row.decision,
        decidedAtIso: row.decided_at.toISOString(),
        revalidatedAtIso: row.revalidated_at?.toISOString() ?? null,
        evidenceHash: row.evidence_hash,
        summary: row.record?.action.summary ?? 'Action details are no longer available.',
        status: row.record?.status ?? null,
      }));
    });
  }

  /** A web decision only records authorization; workflow resume must revalidate before execution. */
  async reviewActionApproval(
    accountId: string,
    actionId: string,
    decision: 'APPROVED' | 'REJECTED',
    evidence?: ApprovalRevalidationEvidence,
  ): Promise<ActionRecord> {
    return this.withAccount(accountId, async (client) => {
      if (decision === 'APPROVED' && !evidence) {
        throw new Error('approval requires fresh-read and policy revalidation evidence');
      }
      if (decision === 'APPROVED') {
        await client.query(
          `INSERT INTO dira_account_policy_settings (account_id, policy) VALUES ($1, $2::jsonb)
           ON CONFLICT (account_id) DO NOTHING`,
          [accountId, JSON.stringify(DEFAULT_ACCOUNT_POLICY)],
        );
        const [stateResult, profileResult, policyResult] = await Promise.all([
          client.query<{ state: DomainState }>(
            'SELECT state FROM dira_account_state WHERE account_id = $1 FOR UPDATE',
            [accountId],
          ),
          client.query<{ profile: AvailabilityProfile }>(
            'SELECT profile FROM dira_availability_profiles WHERE account_id = $1 FOR SHARE',
            [accountId],
          ),
          client.query<{ policy: unknown }>(
            'SELECT policy FROM dira_account_policy_settings WHERE account_id = $1 FOR SHARE',
            [accountId],
          ),
        ]);
        if (!stateResult.rows[0] || !profileResult.rows[0]
          || contentHash(stateResult.rows[0].state) !== evidence!.stateVersion
          || contentHash(profileResult.rows[0].profile) !== evidence!.profileVersion
          || !policyResult.rows[0]
          || contentHash(AccountPolicySettingsSchema.parse(policyResult.rows[0].policy)) !== evidence!.policyVersion) {
          throw new Error('account graph, focus hours, or policy changed during approval revalidation; check again');
        }
      }
      const selected = await client.query<{ record_index: number; record: ActionRecord }>(
        `SELECT record_index, record FROM dira_action_ledger
         WHERE account_id = $1 AND action_id = $2 FOR UPDATE`,
        [accountId, actionId],
      );
      const row = selected.rows[0];
      if (!row) throw new Error('approval action not found');
      if (row.record.status !== 'AWAITING_APPROVAL') throw new Error('action is no longer awaiting approval');
      if (row.record.policyVerdict !== 'REQUIRE_APPROVAL') throw new Error('action policy does not require approval');

      const now = new Date().toISOString();
      const nextStatus = decision === 'APPROVED' ? 'AUTHORIZED' : 'REJECTED';
      const record: ActionRecord = {
        ...row.record,
        status: nextStatus,
        approval: {
          ...row.record.approval,
          requestedAtIso: row.record.approval?.requestedAtIso
            ?? row.record.history.find((entry) => entry.status === 'AWAITING_APPROVAL')?.atIso,
          decisionAtIso: now,
          decision,
          actorAccountId: accountId,
          source: 'authenticated-web',
          ...(evidence ? {
            revalidatedAtIso: evidence.revalidatedAtIso,
            revalidationEvidenceHash: evidence.evidenceHash,
          } : {}),
        },
        history: [...row.record.history, {
          status: nextStatus,
          atIso: now,
          note: `${decision.toLowerCase()} by authenticated account owner; execution requires resume-time revalidation`,
        }],
      };
      await client.query(
        `UPDATE dira_action_ledger SET status = $3, record = $4::jsonb, updated_at = now()
         WHERE account_id = $1 AND action_id = $2`,
        [accountId, actionId, nextStatus, JSON.stringify(record)],
      );
      await client.query(
        `INSERT INTO dira_action_approvals
           (account_id, action_id, decision, actor_account_id, source, decided_at, revalidated_at,
            evidence_hash, state_version, profile_version)
         VALUES ($1, $2, $3, $1, 'authenticated-web', $4, $5, $6, $7, $8)`,
        [accountId, actionId, decision, now, evidence?.revalidatedAtIso ?? null,
          evidence?.evidenceHash ?? null, evidence?.stateVersion ?? null, evidence?.profileVersion ?? null],
      );
      if (decision === 'REJECTED') {
        const siblings = await client.query<{ action_id: string; record: ActionRecord }>(
          `SELECT action_id, record FROM dira_action_ledger
           WHERE account_id = $1 AND workflow_id = $2 AND action_id <> $3
             AND status IN ('AWAITING_APPROVAL', 'AUTHORIZED') FOR UPDATE`,
          [accountId, row.record.workflowId, actionId],
        );
        for (const sibling of siblings.rows) {
          const stale: ActionRecord = {
            ...sibling.record,
            status: 'STALE',
            failureReason: 'A sibling action in this approved plan was rejected.',
            history: [...sibling.record.history, {
              status: 'STALE', atIso: now, note: 'plan invalidated by account owner rejection',
            }],
          };
          await client.query(
            `UPDATE dira_action_ledger SET status = 'STALE', record = $3::jsonb, updated_at = now()
             WHERE account_id = $1 AND action_id = $2`,
            [accountId, sibling.action_id, JSON.stringify(stale)],
          );
        }
        const workflow = await client.query<{ run: WorkflowRun }>(
          'SELECT run FROM dira_workflows WHERE account_id = $1 AND workflow_id = $2 FOR UPDATE',
          [accountId, row.record.workflowId],
        );
        if (workflow.rows[0]) {
          const run = workflow.rows[0].run;
          run.status = 'WAITING_REVIEW';
          run.statusReason = 'The account owner rejected an action; create a fresh plan before continuing.';
          run.userInterventions += 1;
          await client.query(
            'UPDATE dira_workflows SET run = $3::jsonb, updated_at = now() WHERE account_id = $1 AND workflow_id = $2',
            [accountId, row.record.workflowId, JSON.stringify(run)],
          );
        }
      }
      return record;
    });
  }

  async listGraphProposals(accountId: string, status?: StoredGraphProposal['status']): Promise<StoredGraphProposal[]> {
    return this.withAccount(accountId, async (client) => {
      const result = await client.query<{
        proposal_id: string; source_id: string; source_type: 'google-calendar'; status: StoredGraphProposal['status'];
        source_snapshot: StoredGraphProposal['source']; draft: CalendarCommitmentDraft; model_telemetry: Record<string, unknown>;
      }>(
        `SELECT proposal_id, source_id, source_type, status, source_snapshot, draft, model_telemetry
         FROM dira_graph_proposals WHERE account_id = $1 AND ($2::text IS NULL OR status = $2)
         ORDER BY created_at DESC`,
        [accountId, status ?? null],
      );
      const stateResult = await client.query<{ state: DomainState }>(
        'SELECT state FROM dira_account_state WHERE account_id = $1',
        [accountId],
      );
      const state = stateResult.rows[0]?.state;
      return result.rows.map((row) => ({
        proposalId: row.proposal_id, sourceId: row.source_id, sourceType: row.source_type,
        status: row.status, source: row.source_snapshot, draft: row.draft, model: row.model_telemetry,
      }));
    });
  }

  async saveGraphProposal(
    accountId: string,
    input: GraphProposalInput,
    status: 'PENDING_REVIEW' | 'IGNORED' = 'PENDING_REVIEW',
  ): Promise<boolean> {
    return this.withAccount(accountId, async (client) => {
      const result = await client.query(
        `INSERT INTO dira_graph_proposals
           (account_id, proposal_id, source_id, source_type, status, source_snapshot, draft, model_telemetry, decided_at)
         VALUES ($1, $2, $3, 'google-calendar', $4, $5::jsonb, $6::jsonb, $7::jsonb,
                 CASE WHEN $4 = 'IGNORED' THEN now() ELSE NULL END)
         ON CONFLICT (account_id, source_id) DO UPDATE SET
           proposal_id = EXCLUDED.proposal_id,
           status = EXCLUDED.status,
           source_snapshot = EXCLUDED.source_snapshot,
           draft = EXCLUDED.draft,
           model_telemetry = EXCLUDED.model_telemetry,
           created_at = now(), updated_at = now(),
           decided_at = CASE WHEN EXCLUDED.status = 'IGNORED' THEN now() ELSE NULL END
         WHERE dira_graph_proposals.source_snapshot->>'version' IS DISTINCT FROM EXCLUDED.source_snapshot->>'version'
         RETURNING proposal_id`,
        [accountId, randomUUID(), input.source.id, status, JSON.stringify(input.source), JSON.stringify(input.draft), JSON.stringify(input.model)],
      );
      return result.rowCount === 1;
    });
  }

  async reviewGraphProposal(
    accountId: string,
    proposalId: string,
    decision: 'CONFIRMED' | 'REJECTED',
    edits?: GraphProposalEditsInput,
  ): Promise<{ status: StoredGraphProposal['status']; commitment?: Commitment }> {
    return this.withAccount(accountId, async (client) => {
      const result = await client.query<{
        status: StoredGraphProposal['status']; source_snapshot: StoredGraphProposal['source']; draft: CalendarCommitmentDraft;
      }>(
        `SELECT status, source_snapshot, draft FROM dira_graph_proposals
         WHERE account_id = $1 AND proposal_id = $2 FOR UPDATE`,
        [accountId, proposalId],
      );
      const proposal = result.rows[0];
      if (!proposal) throw new Error('graph proposal not found');
      if (proposal.status !== 'PENDING_REVIEW') throw new Error(`proposal is already ${proposal.status.toLowerCase()}`);
      if (decision === 'REJECTED') {
        await client.query(
          `UPDATE dira_graph_proposals SET status = 'REJECTED', decided_at = now(), updated_at = now()
           WHERE account_id = $1 AND proposal_id = $2`,
          [accountId, proposalId],
        );
        return { status: 'REJECTED' };
      }

      const stateResult = await client.query<{ state: DomainState }>(
        'SELECT state FROM dira_account_state WHERE account_id = $1 FOR UPDATE',
        [accountId],
      );
      const state = stateResult.rows[0]?.state;
      if (!state) throw new Error('account state is not initialized');
      assertAccountMatch(accountId, state.userId);
      const source = proposal.source_snapshot;
      const externalId = source.id.replace(/^google:/, '');
      const existingCommitment = Object.values(state.commitments).find(
        (item) => item.externalSystem === 'calendar' && item.externalId === externalId,
      );
      if (source.changeType === 'CANCELLED') {
        if (!existingCommitment) throw new Error('cancelled Calendar commitment is no longer in the graph');
        existingCommitment.status = 'DROPPED';
        existingCommitment.updatedAtIso = new Date().toISOString();
        await client.query(
          'UPDATE dira_account_state SET state = $2::jsonb, updated_at = now() WHERE account_id = $1',
          [accountId, JSON.stringify(state)],
        );
        await client.query(
          `UPDATE dira_graph_proposals SET status = 'CONFIRMED', decided_at = now(), updated_at = now()
           WHERE account_id = $1 AND proposal_id = $2`,
          [accountId, proposalId],
        );
        return { status: 'CONFIRMED', commitment: existingCommitment };
      }
      if (!edits || !edits.title.trim() || edits.title.length > 200) throw new Error('valid edited commitment fields are required');
      const startIso = calendarValueToIso(proposal.source_snapshot.startIso, state.timezone ?? 'UTC');
      const endIso = calendarValueToIso(proposal.source_snapshot.endIso, state.timezone ?? 'UTC');
      const startMin = isoToMinutes(startIso, state.horizonStartIso);
      const endMin = isoToMinutes(endIso, state.horizonStartIso);
      if (endMin <= startMin) throw new Error('calendar source has an invalid time range');
      const nowIso = new Date().toISOString();
      const commitment: Commitment = existingCommitment ?? {
        id: `commitment_${randomUUID()}`, userId: accountId, title: edits.title.trim(), domain: edits.domain,
        source: 'google-calendar', sourceReference: `google-calendar:${source.id}`, status: 'PLANNED',
        kind: edits.kind, flexibility: edits.flexibility, criticality: edits.criticality, owner: accountId,
        participants: [accountId], goalIds: [], resourceRequirements: ['user-time'], externalSystem: 'calendar',
        externalId, confidence: proposal.draft.confidence, createdAtIso: nowIso, updatedAtIso: nowIso,
      };
      commitment.title = edits.title.trim();
      commitment.domain = edits.domain;
      commitment.source = 'google-calendar';
      commitment.sourceReference = `google-calendar:${source.id}`;
      commitment.status = 'PLANNED';
      commitment.kind = edits.kind;
      commitment.flexibility = existingCommitment?.flexibility === 'DELEGATABLE'
        ? 'DELEGATABLE'
        : edits.flexibility;
      commitment.criticality = edits.criticality;
      commitment.externalSystem = 'calendar';
      commitment.externalId = externalId;
      commitment.confidence = proposal.draft.confidence;
      commitment.updatedAtIso = nowIso;
      if (edits.kind === 'effort') {
        delete commitment.startMin;
        delete commitment.durationMin;
        commitment.deadlineMin = /^\d{4}-\d{2}-\d{2}$/.test(source.startIso) ? endMin : startMin;
        commitment.requiredEffortMin = edits.estimatedEffortMin ?? undefined;
        commitment.completedEffortMin ??= 0;
      } else {
        delete commitment.deadlineMin;
        delete commitment.releaseMin;
        delete commitment.requiredEffortMin;
        delete commitment.completedEffortMin;
        commitment.startMin = startMin;
        commitment.durationMin = endMin - startMin;
      }
      state.commitments[commitment.id] = commitment;
      state.horizonEndMin = Math.max(state.horizonEndMin, endMin + 1);
      const reviewedDraft: CalendarCommitmentDraft = {
        ...proposal.draft,
        title: commitment.title,
        domain: commitment.domain,
        kind: edits.kind,
        estimatedEffortMin: edits.kind === 'effort' ? edits.estimatedEffortMin : null,
        flexibility: commitment.flexibility === 'DELEGATABLE' ? 'FIXED' : commitment.flexibility,
        criticality: commitment.criticality,
      };
      await client.query(
        `UPDATE dira_account_state SET state = $2::jsonb, updated_at = now()
         WHERE account_id = $1`,
        [accountId, JSON.stringify(state)],
      );
      await client.query(
        `UPDATE dira_graph_proposals SET status = 'CONFIRMED', draft = $3::jsonb,
                decided_at = now(), updated_at = now()
         WHERE account_id = $1 AND proposal_id = $2`,
        [accountId, proposalId, JSON.stringify(reviewedDraft)],
      );
      return { status: 'CONFIRMED', commitment };
    });
  }

  async listGraphEdgeProposals(accountId: string, status?: StoredGraphEdgeProposal['status']): Promise<StoredGraphEdgeProposal[]> {
    return this.withAccount(accountId, async (client) => {
      const result = await client.query<{
        proposal_id: string; from_commitment_id: string; to_commitment_id: string;
        edge_type: GraphEdgeDraft['type']; confidence: number; reason: string;
        edge_data: GraphEdgeDraft['data'] | null; model_telemetry: Record<string, unknown>;
        status: StoredGraphEdgeProposal['status'];
      }>(
        `SELECT proposal_id, from_commitment_id, to_commitment_id, edge_type, confidence,
                reason, edge_data, model_telemetry, status
         FROM dira_graph_edge_proposals WHERE account_id = $1 AND ($2::text IS NULL OR status = $2)
         ORDER BY confidence DESC, created_at ASC`,
        [accountId, status ?? null],
      );
      const stateResult = await client.query<{ state: DomainState }>(
        'SELECT state FROM dira_account_state WHERE account_id = $1',
        [accountId],
      );
      const state = stateResult.rows[0]?.state;
      return result.rows.map((row) => ({
        proposalId: row.proposal_id,
        from: row.from_commitment_id,
        to: row.to_commitment_id,
        type: row.edge_type,
        confidence: row.confidence,
        reason: row.reason,
        data: row.edge_data ?? undefined,
        model: row.model_telemetry,
        status: row.status,
        fromTitle: state?.commitments[row.from_commitment_id]?.title ?? row.from_commitment_id,
        toTitle: state?.commitments[row.to_commitment_id]?.title ?? row.to_commitment_id,
      }));
    });
  }

  async saveGraphEdgeProposals(
    accountId: string,
    edges: GraphEdgeDraft[],
    model: Record<string, unknown>,
  ): Promise<number> {
    return this.withAccount(accountId, async (client) => {
      let insertedCount = 0;
      for (const edge of edges) {
        const result = await client.query(
          `INSERT INTO dira_graph_edge_proposals
             (account_id, proposal_id, from_commitment_id, to_commitment_id, edge_type,
              confidence, reason, edge_data, model_telemetry, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, 'PENDING_REVIEW')
           ON CONFLICT (account_id, from_commitment_id, to_commitment_id, edge_type) DO NOTHING
           RETURNING proposal_id`,
          [accountId, randomUUID(), edge.from, edge.to, edge.type, edge.confidence,
            edge.reason, JSON.stringify(edge.data ?? null), JSON.stringify(model)],
        );
        insertedCount += result.rowCount ?? 0;
      }
      return insertedCount;
    });
  }

  async reviewGraphEdgeProposal(
    accountId: string,
    proposalId: string,
    decision: 'CONFIRMED' | 'REJECTED',
    edits?: GraphEdgeDataEditsInput,
  ): Promise<{ status: StoredGraphEdgeProposal['status']; edge?: DomainState['edges'][number] }> {
    return this.withAccount(accountId, async (client) => {
      const result = await client.query<{
        status: StoredGraphEdgeProposal['status']; from_commitment_id: string; to_commitment_id: string;
        edge_type: GraphEdgeDraft['type']; reason: string; edge_data: GraphEdgeDraft['data'] | null;
      }>(
        `SELECT status, from_commitment_id, to_commitment_id, edge_type, reason, edge_data
         FROM dira_graph_edge_proposals WHERE account_id = $1 AND proposal_id = $2 FOR UPDATE`,
        [accountId, proposalId],
      );
      const proposal = result.rows[0];
      if (!proposal) throw new Error('graph edge proposal not found');
      if (proposal.status !== 'PENDING_REVIEW') throw new Error(`edge proposal is already ${proposal.status.toLowerCase()}`);
      if (decision === 'REJECTED') {
        await client.query(
          `UPDATE dira_graph_edge_proposals SET status = 'REJECTED', decided_at = now(), updated_at = now()
           WHERE account_id = $1 AND proposal_id = $2`,
          [accountId, proposalId],
        );
        return { status: 'REJECTED' };
      }

      const stateResult = await client.query<{ state: DomainState }>(
        'SELECT state FROM dira_account_state WHERE account_id = $1 FOR UPDATE',
        [accountId],
      );
      const state = stateResult.rows[0]?.state;
      if (!state) throw new Error('account state is not initialized');
      assertAccountMatch(accountId, state.userId);
      if (!state.commitments[proposal.from_commitment_id] || !state.commitments[proposal.to_commitment_id]) {
        throw new Error('edge endpoints are no longer present in this account graph');
      }
      const edgeData = edits ?? proposal.edge_data ?? undefined;
      const allowedDataField = proposal.edge_type === 'REQUIRES_BUFFER' ? 'bufferMin'
        : proposal.edge_type === 'REQUIRES_PREPARATION' ? 'finalBufferMin'
          : proposal.edge_type === 'SHARES_RESOURCE_WITH' ? 'resource' : undefined;
      if (edgeData && Object.keys(edgeData).some((key) => key !== allowedDataField)) {
        throw new Error(`${proposal.edge_type} contains unsupported edge data`);
      }
      if (proposal.edge_type === 'REQUIRES_BUFFER' && edgeData?.bufferMin === undefined) {
        throw new Error('buffer duration is required to confirm this link');
      }
      if (proposal.edge_type === 'REQUIRES_PREPARATION' && edgeData?.finalBufferMin === undefined) {
        throw new Error('preparation deadline is required to confirm this link');
      }
      if (proposal.edge_type === 'SHARES_RESOURCE_WITH' && !edgeData?.resource) {
        throw new Error('resource name is required to confirm this link');
      }
      if (state.edges.some((edge) => edge.type === proposal.edge_type
        && edge.from === proposal.from_commitment_id && edge.to === proposal.to_commitment_id)) {
        throw new Error('this link is already confirmed');
      }
      const edge: DomainState['edges'][number] = {
        id: `edge_${randomUUID()}`,
        from: proposal.from_commitment_id,
        to: proposal.to_commitment_id,
        type: proposal.edge_type,
        data: {
          ...(edgeData ?? {}),
          provenance: `user-confirmation:${proposalId}`,
        },
      };
      state.edges.push(edge);
      await client.query(
        `UPDATE dira_account_state SET state = $2::jsonb, updated_at = now() WHERE account_id = $1`,
        [accountId, JSON.stringify(state)],
      );
      await client.query(
        `UPDATE dira_graph_edge_proposals SET status = 'CONFIRMED', decided_at = now(), updated_at = now()
         WHERE account_id = $1 AND proposal_id = $2`,
        [accountId, proposalId],
      );
      return { status: 'CONFIRMED', edge };
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

export function createEmptyDomainState(accountId: string, timezone: string, now = new Date()): DomainState {
  return {
    userId: accountId,
    timezone,
    horizonStartIso: now.toISOString(),
    horizonEndMin: 90 * 24 * 60,
    commitments: {},
    edges: [],
    people: {},
    constraints: {},
    availability: [],
    approvedSlots: {},
    config: { ...DEFAULT_ENGINE_CONFIG },
  };
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
        'SELECT record FROM dira_action_ledger WHERE account_id = $1 ORDER BY record_index, action_id',
        [this.accountId],
      );
      return result.rows.map((row) => row.record);
    });
  }

  async save(records: ActionRecord[]): Promise<void> {
    return this.store.withAccount(this.accountId, async (client) => {
      for (const [recordIndex, record] of records.entries()) {
        await client.query(
          `INSERT INTO dira_action_ledger
             (account_id, record_index, action_id, workflow_id, idempotency_key, status, record)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (account_id, action_id) DO UPDATE SET
             record_index = EXCLUDED.record_index, workflow_id = EXCLUDED.workflow_id,
             idempotency_key = EXCLUDED.idempotency_key, status = EXCLUDED.status,
             record = EXCLUDED.record, updated_at = now()
           WHERE EXCLUDED.record #>> '{history,-1,atIso}'
             >= dira_action_ledger.record #>> '{history,-1,atIso}'`,
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

function calendarValueToIso(value: string, timezone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return localDateTimeToIso(`${value}T00:00`, timezone);
  }
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new Error(`invalid calendar timestamp ${value}`);
  return new Date(epoch).toISOString();
}

function contentHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

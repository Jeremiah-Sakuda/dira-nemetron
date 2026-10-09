import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { DEFAULT_ENGINE_CONFIG, isoToMinutes, localDateTimeToIso, type Commitment, type DomainState } from '@dira/commitment-model';
import type { ActionRecord, LedgerStore } from '@dira/action-ledger';
import type { WorkflowRun, WorkflowStore } from '@dira/agent';
import type { CalendarCommitmentDraft, GraphEdgeDataEditsInput, GraphEdgeDraft, GraphProposalEditsInput } from '@dira/agent';

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

export interface StoredGraphProposal {
  proposalId: string;
  sourceId: string;
  sourceType: 'google-calendar';
  status: 'PENDING_REVIEW' | 'CONFIRMED' | 'REJECTED' | 'IGNORED';
  source: { id: string; title: string; startIso: string; endIso: string };
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
         ON CONFLICT (account_id, source_id) DO NOTHING RETURNING proposal_id`,
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
      if (!edits || !edits.title.trim() || edits.title.length > 200) throw new Error('valid edited commitment fields are required');

      const stateResult = await client.query<{ state: DomainState }>(
        'SELECT state FROM dira_account_state WHERE account_id = $1 FOR UPDATE',
        [accountId],
      );
      const state = stateResult.rows[0]?.state;
      if (!state) throw new Error('account state is not initialized');
      assertAccountMatch(accountId, state.userId);
      const startIso = calendarValueToIso(proposal.source_snapshot.startIso, state.timezone ?? 'UTC');
      const endIso = calendarValueToIso(proposal.source_snapshot.endIso, state.timezone ?? 'UTC');
      const startMin = isoToMinutes(startIso, state.horizonStartIso);
      const endMin = isoToMinutes(endIso, state.horizonStartIso);
      if (endMin <= startMin) throw new Error('calendar source has an invalid time range');
      const nowIso = new Date().toISOString();
      const commitment: Commitment = {
        id: `commitment_${randomUUID()}`,
        userId: accountId,
        title: edits.title.trim(),
        domain: edits.domain,
        source: 'google-calendar',
        sourceReference: `google-calendar:${proposal.source_snapshot.id}`,
        status: 'PLANNED',
        kind: edits.kind,
        startMin,
        durationMin: endMin - startMin,
        flexibility: edits.flexibility,
        criticality: edits.criticality,
        owner: accountId,
        participants: [accountId],
        goalIds: [],
        resourceRequirements: ['user-time'],
        externalSystem: 'calendar',
        externalId: proposal.source_snapshot.id.replace(/^google:/, ''),
        confidence: proposal.draft.confidence,
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
      };
      state.commitments[commitment.id] = commitment;
      state.horizonEndMin = Math.max(state.horizonEndMin, endMin + 1);
      const reviewedDraft: CalendarCommitmentDraft = {
        ...proposal.draft,
        title: commitment.title,
        domain: commitment.domain,
        kind: edits.kind,
        flexibility: edits.flexibility,
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

function calendarValueToIso(value: string, timezone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return localDateTimeToIso(`${value}T00:00`, timezone);
  }
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new Error(`invalid calendar timestamp ${value}`);
  return new Date(epoch).toISOString();
}

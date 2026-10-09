import type { PlannedAction } from '@dira/event-schema';

/**
 * Durable Action Ledger / Outbox (PRD §23–§26).
 *
 * Internal intent and external reality are reconciled through explicit
 * states. An action only ever becomes VERIFIED after an independent read of
 * external state — a tool's success response is never trusted on its own.
 *
 * The ledger is storage-agnostic: an in-memory store for tests, a JSON-file
 * store so the replay CLI survives process crashes, and (in production) a
 * Firestore collection behind the same interface.
 */

export type ActionStatus =
  | 'PLANNED'
  | 'AWAITING_APPROVAL'
  | 'AUTHORIZED'
  | 'PENDING_EXECUTION'
  | 'EXECUTING'
  | 'EXECUTED_UNVERIFIED'
  | 'VERIFIED'
  | 'FAILED_TRANSIENT'
  | 'FAILED_PERMANENT'
  | 'STALE'
  | 'REPLAN_REQUIRED'
  | 'REJECTED';

const LEGAL_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  PLANNED: ['AWAITING_APPROVAL', 'AUTHORIZED', 'STALE'],
  AWAITING_APPROVAL: ['AUTHORIZED', 'REJECTED', 'STALE'],
  AUTHORIZED: ['PENDING_EXECUTION', 'STALE'],
  PENDING_EXECUTION: ['EXECUTING', 'STALE'],
  EXECUTING: ['EXECUTED_UNVERIFIED', 'FAILED_TRANSIENT', 'FAILED_PERMANENT'],
  EXECUTED_UNVERIFIED: ['VERIFIED', 'REPLAN_REQUIRED', 'FAILED_TRANSIENT'],
  FAILED_TRANSIENT: ['PENDING_EXECUTION', 'FAILED_PERMANENT'],
  FAILED_PERMANENT: ['REPLAN_REQUIRED'],
  VERIFIED: [],
  // A STALE action belongs to an invalidated plan; if a *new* authorized plan
  // re-issues the identical intent (same idempotency key), it is revived
  // through AUTHORIZED rather than duplicated.
  STALE: ['AUTHORIZED'],
  REPLAN_REQUIRED: [],
  REJECTED: [],
};

export interface ActionApproval {
  requestedAtIso?: string;
  decisionAtIso?: string;
  decision?: 'APPROVED' | 'REJECTED';
  actorAccountId?: string;
  source?: 'authenticated-web';
  revalidatedAtIso?: string;
  revalidationEvidenceHash?: string;
}

export interface ActionRecord {
  actionId: string;
  workflowId: string;
  action: PlannedAction;
  idempotencyKey: string;
  policyVerdict: string;
  policyRule: string;
  status: ActionStatus;
  attempts: number;
  /** Which planning round authorized (or re-authorized) this intent. */
  planId?: string;
  /** Execution order within that plan; claims are served lowest-first. */
  planSeq?: number;
  externalResponse?: unknown;
  failureReason?: string;
  verification?: { verifiedAtIso: string; observed: unknown };
  approval?: ActionApproval;
  history: { status: ActionStatus; atIso: string; note?: string }[];
}

/** PRD §26 — deterministic idempotency key. */
export function idempotencyKey(workflowId: string, action: PlannedAction): string {
  const desired = Object.entries(action.desired_state)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(',');
  return `${workflowId}:${action.type.toLowerCase()}:${action.target}:${desired}`;
}

/**
 * The ledger API the orchestrator programs against. Implemented by the local
 * ActionLedger (in-memory/file stores) and by FirestoreActionLedger
 * (per-document records with transactional claiming) — see firestore-ledger.
 */
export interface LedgerApi {
  all(): ActionRecord[] | Promise<ActionRecord[]>;
  byWorkflow(workflowId: string): ActionRecord[];
  get(actionId: string): ActionRecord | undefined;
  findByIdempotencyKey(key: string): ActionRecord | undefined;
  persistIntent(
    workflowId: string,
    action: PlannedAction,
    policyVerdict: string,
    policyRule: string,
    planOrder?: { planId: string; seq: number },
  ): Promise<{ record: ActionRecord; created: boolean }>;
  transition(
    actionId: string,
    to: ActionStatus,
    patch?: Partial<Pick<ActionRecord, 'externalResponse' | 'failureReason' | 'verification'>>,
    note?: string,
  ): Promise<ActionRecord>;
  claimNext(workflowId: string): Promise<ActionRecord | undefined>;
}

export interface LedgerStore {
  load(): Promise<ActionRecord[]>;
  save(records: ActionRecord[]): Promise<void>;
}

export class InMemoryLedgerStore implements LedgerStore {
  private records: ActionRecord[] = [];
  async load(): Promise<ActionRecord[]> {
    return structuredClone(this.records);
  }
  async save(records: ActionRecord[]): Promise<void> {
    this.records = structuredClone(records);
  }
}

export class ActionLedger {
  private constructor(
    private readonly store: LedgerStore,
    private records: ActionRecord[],
    private readonly now: () => string,
  ) {}

  static async open(store: LedgerStore, now: () => string = () => new Date().toISOString()) {
    return new ActionLedger(store, await store.load(), now);
  }

  all(): ActionRecord[] {
    return structuredClone(this.records);
  }

  byWorkflow(workflowId: string): ActionRecord[] {
    return structuredClone(this.records.filter((r) => r.workflowId === workflowId));
  }

  get(actionId: string): ActionRecord | undefined {
    const r = this.records.find((x) => x.actionId === actionId);
    return r ? structuredClone(r) : undefined;
  }

  findByIdempotencyKey(key: string): ActionRecord | undefined {
    const r = this.records.find((x) => x.idempotencyKey === key);
    return r ? structuredClone(r) : undefined;
  }

  /**
   * Persist an authorized intent. Redelivery-safe: if a record with the same
   * idempotency key already exists, the existing record is returned and no
   * duplicate is created (PRD §26).
   */
  async persistIntent(
    workflowId: string,
    action: PlannedAction,
    policyVerdict: string,
    policyRule: string,
    planOrder?: { planId: string; seq: number },
  ): Promise<{ record: ActionRecord; created: boolean }> {
    const key = idempotencyKey(workflowId, action);
    const existing = this.records.find((r) => r.idempotencyKey === key);
    if (existing) {
      if (planOrder) {
        existing.planId = planOrder.planId;
        existing.planSeq = planOrder.seq;
        await this.store.save(this.records);
      }
      return { record: structuredClone(existing), created: false };
    }

    const record: ActionRecord = {
      actionId: `act_${this.records.length + 1}_${key.slice(0, 24).replace(/[^a-z0-9-]/gi, '')}`,
      workflowId,
      action,
      idempotencyKey: key,
      policyVerdict,
      policyRule,
      status: 'PLANNED',
      attempts: 0,
      planId: planOrder?.planId,
      planSeq: planOrder?.seq,
      history: [{ status: 'PLANNED', atIso: this.now() }],
    };
    this.records.push(record);
    await this.store.save(this.records);
    return { record: structuredClone(record), created: true };
  }

  async transition(
    actionId: string,
    to: ActionStatus,
    patch: Partial<Pick<ActionRecord, 'externalResponse' | 'failureReason' | 'verification' | 'approval'>> = {},
    note?: string,
  ): Promise<ActionRecord> {
    const record = this.records.find((r) => r.actionId === actionId);
    if (!record) throw new Error(`No ledger record ${actionId}`);
    const legal = LEGAL_TRANSITIONS[record.status];
    if (!legal.includes(to)) {
      throw new Error(`Illegal ledger transition ${record.status} → ${to} for ${actionId}`);
    }
    record.status = to;
    if (to === 'EXECUTING') record.attempts += 1;
    Object.assign(record, patch);
    record.history.push({ status: to, atIso: this.now(), note });
    await this.store.save(this.records);
    return structuredClone(record);
  }

  /**
   * Claim the next pending action for execution, in plan order (revived
   * intents run where the *new* plan sequenced them, not where the old plan
   * left them). NOTE: the local stores are single-process; true multi-worker
   * claiming requires the Firestore store's transactional
   * PENDING_EXECUTION → EXECUTING compare-and-set (see
   * infrastructure/firestore/collections.md).
   */
  async claimNext(workflowId: string): Promise<ActionRecord | undefined> {
    const pending = this.records
      .filter((r) => r.workflowId === workflowId && r.status === 'PENDING_EXECUTION')
      .sort((a, b) => (a.planSeq ?? Number.MAX_SAFE_INTEGER) - (b.planSeq ?? Number.MAX_SAFE_INTEGER));
    const record = pending[0];
    if (!record) return undefined;
    return this.transition(record.actionId, 'EXECUTING');
  }
}

export function isTerminal(status: ActionStatus): boolean {
  return LEGAL_TRANSITIONS[status].length === 0;
}

export { LEGAL_TRANSITIONS };

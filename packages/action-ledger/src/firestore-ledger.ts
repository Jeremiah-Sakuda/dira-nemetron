import type { Firestore } from '@google-cloud/firestore';
import {
  LEGAL_TRANSITIONS,
  idempotencyKey,
  type ActionRecord,
  type ActionStatus,
  type LedgerApi,
} from './index.js';
import type { PlannedAction } from '@dira/event-schema';

/**
 * Firestore-backed action ledger (PRD §23–§26, production mode).
 *
 * One document per action in `action_ledger/`, keyed by the idempotency key,
 * so "persist intent exactly once" is a transactional create-if-absent and
 * claiming is a transactional PENDING_EXECUTION → EXECUTING compare-and-set:
 * two workers can never double-claim, and Pub/Sub redelivery can never
 * duplicate an intent.
 *
 * Reads are served from an in-memory mirror refreshed on open and after
 * every write, so read coherence relies on the demo deployment's single
 * Cloud Run instance (max-instances=1). The transactional writes (create-if-
 * absent, compare-and-set claim) are the foundation a multi-worker deployment
 * would build on, but lifting the instance cap also requires replacing the
 * mirror with live queries — not claimed or tested here.
 */
export class FirestoreActionLedger implements LedgerApi {
  private mirror = new Map<string, ActionRecord>();

  private constructor(
    private readonly db: Firestore,
    private readonly now: () => string,
  ) {}

  private col() {
    return this.db.collection('action_ledger');
  }

  static async open(
    db: Firestore,
    now: () => string = () => new Date().toISOString(),
  ): Promise<FirestoreActionLedger> {
    const ledger = new FirestoreActionLedger(db, now);
    await ledger.refresh();
    return ledger;
  }

  async refresh(): Promise<void> {
    const snap = await this.col().get();
    this.mirror.clear();
    for (const doc of snap.docs) {
      const record = doc.data() as ActionRecord;
      this.mirror.set(record.actionId, record);
    }
  }

  private docIdForKey(key: string): string {
    return key.replace(/\//g, '_');
  }

  all(): ActionRecord[] {
    return [...this.mirror.values()].map((r) => structuredClone(r));
  }

  byWorkflow(workflowId: string): ActionRecord[] {
    return this.all().filter((r) => r.workflowId === workflowId);
  }

  get(actionId: string): ActionRecord | undefined {
    const r = this.mirror.get(actionId);
    return r ? structuredClone(r) : undefined;
  }

  findByIdempotencyKey(key: string): ActionRecord | undefined {
    const r = [...this.mirror.values()].find((x) => x.idempotencyKey === key);
    return r ? structuredClone(r) : undefined;
  }

  async persistIntent(
    workflowId: string,
    action: PlannedAction,
    policyVerdict: string,
    policyRule: string,
    planOrder?: { planId: string; seq: number },
  ): Promise<{ record: ActionRecord; created: boolean }> {
    const key = idempotencyKey(workflowId, action);
    const ref = this.col().doc(this.docIdForKey(key));

    const result = await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const existing = snap.data() as ActionRecord;
        if (planOrder) {
          existing.planId = planOrder.planId;
          existing.planSeq = planOrder.seq;
          tx.set(ref, existing);
        }
        return { record: existing, created: false };
      }
      const record: ActionRecord = {
        // Full key: a truncated id can collide (two notifications to the
        // same recipient) and silently overwrite mirror entries.
        actionId: `act_${this.docIdForKey(key)}`,
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
      tx.set(ref, record);
      return { record, created: true };
    });

    this.mirror.set(result.record.actionId, result.record);
    return { record: structuredClone(result.record), created: result.created };
  }

  async transition(
    actionId: string,
    to: ActionStatus,
    patch: Partial<Pick<ActionRecord, 'externalResponse' | 'failureReason' | 'verification' | 'approval'>> = {},
    note?: string,
  ): Promise<ActionRecord> {
    const current = this.mirror.get(actionId);
    if (!current) throw new Error(`No ledger record ${actionId}`);
    const ref = this.col().doc(this.docIdForKey(current.idempotencyKey));

    const updated = await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error(`Ledger doc missing for ${actionId}`);
      const record = snap.data() as ActionRecord;
      if (!LEGAL_TRANSITIONS[record.status].includes(to)) {
        throw new Error(`Illegal ledger transition ${record.status} → ${to} for ${actionId}`);
      }
      record.status = to;
      if (to === 'EXECUTING') record.attempts += 1;
      Object.assign(record, sanitize(patch));
      record.history.push({ status: to, atIso: this.now(), ...(note ? { note } : {}) });
      tx.set(ref, record);
      return record;
    });

    this.mirror.set(updated.actionId, updated);
    return structuredClone(updated);
  }

  /** Transactional claim: PENDING_EXECUTION → EXECUTING, lowest planSeq first. */
  async claimNext(workflowId: string): Promise<ActionRecord | undefined> {
    const claimed = await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(
        this.col()
          .where('workflowId', '==', workflowId),
      );
      const pending = snap.docs
        .map((d) => d.data() as ActionRecord)
        .filter((record) => record.status === 'PENDING_EXECUTION')
        .sort((a, b) => (a.planSeq ?? Number.MAX_SAFE_INTEGER) - (b.planSeq ?? Number.MAX_SAFE_INTEGER));
      const record = pending[0];
      if (!record) return undefined;
      record.status = 'EXECUTING';
      record.attempts += 1;
      record.history.push({ status: 'EXECUTING', atIso: this.now() });
      tx.set(this.col().doc(this.docIdForKey(record.idempotencyKey)), record);
      return record;
    });
    if (claimed) this.mirror.set(claimed.actionId, claimed);
    return claimed ? structuredClone(claimed) : undefined;
  }
}

/** Firestore rejects `undefined` field values; drop them. */
function sanitize<T extends Record<string, unknown>>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

import { describe, expect, it } from 'vitest';
import {
  ActionLedger,
  idempotencyKey,
  InMemoryLedgerStore,
  isTerminal,
  LEGAL_TRANSITIONS,
} from '@dira/action-ledger';
import type { PlannedAction } from '@dira/event-schema';

const sample: PlannedAction = {
  type: 'BOOK_INTERVIEW_SLOT',
  target: 'interview-1',
  desired_state: { start_min: 3660, slot_id: 'slot-a' },
  provenance: ['thread-1'],
  external_system: 'recruiter',
  summary: 'book',
};

describe('durable action ledger (PRD §23–§26)', () => {
  it('builds deterministic idempotency keys from workflow/type/target/state', () => {
    const k1 = idempotencyKey('wf1', sample);
    const k2 = idempotencyKey('wf1', structuredClone(sample));
    expect(k1).toBe(k2);
    expect(k1).toContain('wf1:book_interview_slot:interview-1');
    expect(idempotencyKey('wf2', sample)).not.toBe(k1);
  });

  it('persistIntent is redelivery-safe: same key never duplicates', async () => {
    const ledger = await ActionLedger.open(new InMemoryLedgerStore());
    const a = await ledger.persistIntent('wf1', sample, 'ALLOW', 'rule');
    const b = await ledger.persistIntent('wf1', sample, 'ALLOW', 'rule');
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(ledger.all()).toHaveLength(1);
  });

  it('walks the full lifecycle and records history', async () => {
    const ledger = await ActionLedger.open(new InMemoryLedgerStore());
    const { record } = await ledger.persistIntent('wf1', sample, 'ALLOW', 'rule');
    await ledger.transition(record.actionId, 'AUTHORIZED');
    await ledger.transition(record.actionId, 'PENDING_EXECUTION');
    const claimed = await ledger.claimNext('wf1');
    expect(claimed?.status).toBe('EXECUTING');
    expect(claimed?.attempts).toBe(1);
    await ledger.transition(record.actionId, 'EXECUTED_UNVERIFIED');
    const done = await ledger.transition(record.actionId, 'VERIFIED');
    expect(done.history.map((h) => h.status)).toEqual([
      'PLANNED', 'AUTHORIZED', 'PENDING_EXECUTION', 'EXECUTING', 'EXECUTED_UNVERIFIED', 'VERIFIED',
    ]);
    expect(isTerminal(done.status)).toBe(true);
  });

  it('rejects illegal transitions', async () => {
    const ledger = await ActionLedger.open(new InMemoryLedgerStore());
    const { record } = await ledger.persistIntent('wf1', sample, 'ALLOW', 'rule');
    await expect(ledger.transition(record.actionId, 'VERIFIED')).rejects.toThrow(
      /Illegal ledger transition/,
    );
  });

  it('VERIFIED is immutable; STALE is revived only by re-authorization or a fresh approval request', () => {
    expect(LEGAL_TRANSITIONS.VERIFIED).toEqual([]);
    // A re-issued intent never jumps straight to execution: it is either
    // re-authorized by policy or goes back to waiting for an owner decision.
    expect(LEGAL_TRANSITIONS.STALE).toEqual(['AUTHORIZED', 'AWAITING_APPROVAL']);
    expect(LEGAL_TRANSITIONS.AWAITING_APPROVAL).not.toContain('PENDING_EXECUTION');
    expect(LEGAL_TRANSITIONS.REPLAN_REQUIRED).toEqual([]);
  });

  it('transient failure can retry; permanent failure must replan', async () => {
    const ledger = await ActionLedger.open(new InMemoryLedgerStore());
    const { record } = await ledger.persistIntent('wf1', sample, 'ALLOW', 'rule');
    await ledger.transition(record.actionId, 'AUTHORIZED');
    await ledger.transition(record.actionId, 'PENDING_EXECUTION');
    await ledger.claimNext('wf1');
    await ledger.transition(record.actionId, 'FAILED_TRANSIENT');
    await ledger.transition(record.actionId, 'PENDING_EXECUTION');
    const again = await ledger.claimNext('wf1');
    expect(again?.attempts).toBe(2);
    await ledger.transition(record.actionId, 'FAILED_PERMANENT');
    const final = await ledger.transition(record.actionId, 'REPLAN_REQUIRED');
    expect(isTerminal(final.status)).toBe(true);
  });
});

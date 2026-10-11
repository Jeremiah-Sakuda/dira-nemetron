import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresAccountStore } from '../../services/orchestrator/src/postgres-store.js';
import { buildDemoWorld } from '../../services/orchestrator/src/demo-world.js';
import {
  createDemoAccount,
  deleteAccountData,
  listFlightRecords,
  readExecutionSurfaces,
  recordOwnerDecision,
} from '../../services/orchestrator/src/account-records.js';
import { handleAccountEmail, resumeAccountRepair, workflowReadyToResume } from '../../services/orchestrator/src/account-repair.js';

/**
 * Runs only when DIRA_TEST_DATABASE_URL points at a disposable database owned
 * by a NON-superuser role (superusers bypass row-level security):
 *   DIRA_TEST_DATABASE_URL=postgresql://dira_app:dira_app@localhost:55432/dira_test npm run test:postgres
 */
const url = process.env.DIRA_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('demo persona: event repair against PostgreSQL', () => {
  let store: PostgresAccountStore;
  const created: string[] = [];

  beforeAll(async () => {
    delete process.env.NEBIUS_API_KEY;
    store = new PostgresAccountStore(new Pool({ connectionString: url, max: 6 }));
    await store.initialize();
    const role = await store.pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  afterAll(async () => {
    for (const id of created) await deleteAccountData(store, id).catch(() => undefined);
    await store?.close();
  });

  async function newDemo() {
    const accountId = `demo-${randomUUID()}`;
    const world = buildDemoWorld(accountId, new Date('2026-10-11T15:00:00Z'));
    await createDemoAccount(store, accountId, world);
    created.push(accountId);
    return { accountId, world };
  }

  it('pauses the 48-Hour Shock for a delegation approval, then resumes through the 409 and verifies every surface', async () => {
    const { accountId, world } = await newDemo();
    const preset = world.presets.find((item) => item.id === 'professor-move')!;
    const first = await handleAccountEmail(store, accountId, preset.email, { adversarialProbe: true });
    expect(first.run.status).toBe('AWAITING_APPROVAL');
    expect(first.flight.some((entry) => entry.phase === 'REJECT' && entry.message.includes('adversarial'))).toBe(true);
    expect(first.flight.some((entry) => entry.phase === 'PROPOSE')).toBe(true);

    const before = await readExecutionSurfaces(store, accountId);
    expect(before.messages.filter((message) => message.folder !== 'INBOX')).toHaveLength(0);

    const pending = await store.listPendingApprovals(accountId);
    expect(pending.map((record) => record.action.type)).toEqual(['DELEGATE_TASK']);
    await recordOwnerDecision(store, accountId, pending[0]!.actionId, 'APPROVED', 'authenticated-web');
    expect(await workflowReadyToResume(store, accountId, first.run.id)).toBe(true);

    const resumed = await resumeAccountRepair(store, accountId, first.run.id);
    expect(resumed.run.status).toBe('RESOLVED');
    expect(resumed.run.failuresRecovered).toBe(1);

    const after = await readExecutionSurfaces(store, accountId);
    const interview = after.calendar.find((event) => event.id === 'cal-technical-interview-1')!;
    expect(new Date(interview.startIso).getTime()).toBe(new Date(world.presets[0]!.email.receivedAtIso).getTime() + (48 + 4.5) * 3600_000);
    expect(after.delegations.find((task) => task.taskId === 'org-task-visual-qa')!.owner).toBe('maya-okafor');
    expect(after.bookings[0]!.status).toBe('AWAITING_COUNTERPARTY');
    const sent = after.messages.filter((message) => message.folder === 'SENT');
    expect(sent.map((message) => message.to).sort()).toEqual(['jordan.lee@techcorp.demo', 'maya.okafor@university.demo']);
    expect(sent.every((message) => message.body.includes('Dira'))).toBe(true);
    expect(sent.every((message) => !message.to.includes('outside-collector'))).toBe(true);

    const state = await store.loadDomainState(accountId);
    expect(state!.commitments['sponsor-visual-qa']!.owner).toBe('maya-okafor');
    const flight = await listFlightRecords(store, accountId, first.run.id);
    const phases = flight.map((entry) => entry.phase);
    for (const phase of ['INTERPRET', 'PROPAGATE', 'FEASIBILITY', 'PROPOSE', 'REJECT', 'APPROVAL', 'ERROR', 'REPLAN', 'VERIFY', 'RESOLVED']) {
      expect(phases, phase).toContain(phase);
    }
    const blocks = await store.listPolicyBlockEvents(accountId);
    expect(blocks.some((block) => block.actionType === 'ADVERSARIAL_PROPOSAL')).toBe(true);
  });

  it('a prompt-injection email from an outside sender changes nothing and sends nothing', async () => {
    const { accountId, world } = await newDemo();
    const preset = world.presets.find((item) => item.id === 'prompt-injection')!;
    const result = await handleAccountEmail(store, accountId, preset.email, { adversarialProbe: true });
    expect(result.run.status).toBe('WAITING_REVIEW');
    const surfaces = await readExecutionSurfaces(store, accountId);
    expect(surfaces.messages.filter((message) => message.folder !== 'INBOX')).toHaveLength(0);
    const state = await store.loadDomainState(accountId);
    expect(state!.commitments['econ402-midterm-2']!.startMin).toBe(world.state.commitments['econ402-midterm-2']!.startMin);
    const blocks = await store.listPolicyBlockEvents(accountId);
    expect(blocks.some((block) => block.policyRule === 'sender-authority')).toBe(true);
  });

  it('a rejected delegation stops the plan before any external change', async () => {
    const { accountId, world } = await newDemo();
    const first = await handleAccountEmail(store, accountId, world.presets[0]!.email);
    const pending = await store.listPendingApprovals(accountId);
    await recordOwnerDecision(store, accountId, pending[0]!.actionId, 'REJECTED', 'authenticated-web');
    const resumed = await resumeAccountRepair(store, accountId, first.run.id);
    expect(resumed.run.status).toBe('WAITING_REVIEW');
    const surfaces = await readExecutionSurfaces(store, accountId);
    expect(surfaces.messages.filter((message) => message.folder !== 'INBOX')).toHaveLength(0);
    expect(surfaces.bookings).toHaveLength(0);
  });

  it('row-level security keeps demo sessions apart', async () => {
    const a = await newDemo();
    const b = await newDemo();
    await handleAccountEmail(store, a.accountId, a.world.presets[0]!.email);
    const fromB = await store.withAccount(b.accountId, async (client) => {
      const rows = await client.query('SELECT account_id FROM dira_flight_records');
      const ledger = await client.query('SELECT account_id FROM dira_action_ledger');
      return [...rows.rows, ...ledger.rows].map((row) => row.account_id as string);
    });
    expect(fromB.every((id) => id === b.accountId)).toBe(true);
    const noContext = await store.pool.query('SELECT count(*)::int AS n FROM dira_sim_messages');
    expect(noContext.rows[0].n).toBe(0);
  });
});

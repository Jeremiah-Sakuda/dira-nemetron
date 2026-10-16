import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresAccountStore } from '../../services/orchestrator/src/postgres-store.js';
import { buildDemoWorld } from '../../services/orchestrator/src/demo-world.js';
import { createDemoAccount, deleteAccountData } from '../../services/orchestrator/src/account-records.js';
import { syncAccountMemory, exportAccountMemory } from '../../services/orchestrator/src/account-memory.js';
import { configureDurableMemoryStore, withDurableMemory } from '../../services/orchestrator/src/durable-memory.js';
import { runScheduledPass, scheduledRequestAuthorized } from '../../services/orchestrator/src/scheduled-pass.js';

const url = process.env.DIRA_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('serverless private memory and scheduler authentication', () => {
  let store: PostgresAccountStore;
  let memoryStore: PostgresAccountStore;
  let directory: string;
  const ids: string[] = [];
  const previous = { backend: process.env.DIRA_MEMORY_BACKEND, root: process.env.DIRA_MEMORY_ROOT,
    key: process.env.DIRA_TOKEN_ENCRYPTION_KEY, secret: process.env.DIRA_SCHEDULER_SECRET };
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dira-memory-recovery-test-'));
    process.env.DIRA_MEMORY_BACKEND = 'postgres';
    process.env.DIRA_MEMORY_ROOT = directory;
    process.env.DIRA_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    store = new PostgresAccountStore(new Pool({ connectionString: url, max: 6 }));
    memoryStore = new PostgresAccountStore(new Pool({ connectionString: url, max: 2 }));
    await store.initialize();
    configureDurableMemoryStore(memoryStore);
  });
  afterAll(async () => {
    for (const id of ids) await deleteAccountData(store, id);
    await memoryStore.close(); await store.close();
    await rm(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries({ DIRA_MEMORY_BACKEND:previous.backend, DIRA_MEMORY_ROOT:previous.root,
      DIRA_TOKEN_ENCRYPTION_KEY:previous.key, DIRA_SCHEDULER_SECRET:previous.secret })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  it('restores identical Git history and Skills after the local filesystem disappears', async () => {
    const id = `demo-${randomUUID()}`; ids.push(id);
    await createDemoAccount(store, id, buildDemoWorld(id));
    const policy = await store.getAccountPolicySettings(id);
    policy.correctionRules = [{ id:'rule-recovery', kind:'ASK_FIRST', actionType:'MOVE_CALENDAR_EVENT', label:'Ask before moving events' }];
    await syncAccountMemory(id, async () => ({ state:await store.ensureDomainState(id), profile:undefined, policy }));
    const before = await exportAccountMemory(id);
    const hash = createHash('sha256').update(id).digest('hex');
    const row = await store.withAccount(id, client => client.query('SELECT commit_sha,ciphertext FROM dira_memory_bundles WHERE account_id=$1', [id]));
    expect(row.rows[0].ciphertext).not.toContain('ECON 402');
    const graph = await readFile(join(directory, hash, 'graph.json'), 'utf8');
    const skill = await readFile(join(directory, hash, 'skills/dira/rule-recovery/SKILL.md'), 'utf8');
    await rm(directory, { recursive:true, force:true });
    const after = await exportAccountMemory(id);
    expect(after.equals(before)).toBe(true);
    expect(await readFile(join(directory, hash, 'graph.json'), 'utf8')).toBe(graph);
    expect(await readFile(join(directory, hash, 'skills/dira/rule-recovery/SKILL.md'), 'utf8')).toBe(skill);
    expect(row.rows[0].commit_sha).toMatch(/^[0-9a-f]{40}$/);
  });
  it('preserves imported history reachable only through a custom Git reference', async () => {
    const id = `demo-${randomUUID()}`; ids.push(id);
    await createDemoAccount(store, id, buildDemoWorld(id));
    await syncAccountMemory(id, async () => ({ state: await store.ensureDomainState(id), profile: undefined }));
    const path = join(directory, createHash('sha256').update(id).digest('hex'));
    const git = (...args: string[]) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' }).trim();
    let importedCommit = '';
    await withDurableMemory(id, path, async () => {
      const tree = git('rev-parse', 'HEAD^{tree}');
      // A separate root commit represents an imported repository's history.
      // Its only reference is outside the heads/tags fetched by normal clone.
      importedCommit = git('commit-tree', tree, '-m', 'Imported history proof');
      git('update-ref', 'refs/imported/provenance', importedCommit);
    });
    await rm(path, { recursive: true, force: true });
    await exportAccountMemory(id);
    expect(git('rev-parse', 'refs/imported/provenance')).toBe(importedCommit);
    expect(git('cat-file', '-t', importedCommit)).toBe('commit');
  });
  it('denies another tenant access to an encrypted memory bundle', async () => {
    const id = `demo-${randomUUID()}`; ids.push(id);
    await createDemoAccount(store, id, buildDemoWorld(id));
    const rows = await store.withAccount(id, client => client.query('SELECT account_id FROM dira_memory_bundles WHERE account_id=$1', [ids[0]]));
    expect(rows.rowCount).toBe(0);
  });
  it('fails closed when the stored encrypted archive is modified', async () => {
    const id = ids[0]!;
    const original = await store.withAccount(id, client => client.query('SELECT auth_tag FROM dira_memory_bundles WHERE account_id=$1', [id]));
    await store.withAccount(id, client => client.query('UPDATE dira_memory_bundles SET auth_tag=$2 WHERE account_id=$1', [id, randomBytes(16).toString('base64')]));
    await expect(exportAccountMemory(id)).rejects.toThrow();
    await store.withAccount(id, client => client.query('UPDATE dira_memory_bundles SET auth_tag=$2 WHERE account_id=$1', [id, original.rows[0].auth_tag]));
    await expect(exportAccountMemory(id)).resolves.toBeInstanceOf(Buffer);
  });
  it('requires the exact scheduler credential and fails closed without configuration', () => {
    delete process.env.DIRA_SCHEDULER_SECRET;
    expect(scheduledRequestAuthorized('Bearer anything')).toBe(false);
    const secret = randomBytes(32).toString('hex'); process.env.DIRA_SCHEDULER_SECRET=secret;
    expect(scheduledRequestAuthorized(undefined)).toBe(false);
    expect(scheduledRequestAuthorized(`Bearer ${secret}x`)).toBe(false);
    expect(scheduledRequestAuthorized(`Bearer ${secret}`)).toBe(true);
  });
  it('runs durable daily jobs once across repeated scheduled requests', async () => {
    const id = ids[0]!;
    const previousIds = process.env.DIRA_DAILY_JOB_ACCOUNT_IDS;
    process.env.DIRA_DAILY_JOB_ACCOUNT_IDS = id;
    const mirror = async (target: PostgresAccountStore, accountId: string) => {
      await syncAccountMemory(accountId, async () => ({ state:await target.ensureDomainState(accountId), profile:undefined,
        policy:await target.getAccountPolicySettings(accountId) }));
    };
    try {
      const date = new Date('2026-10-14T17:00:00Z');
      expect((await runScheduledPass(store, mirror, () => ({}), date)).failed).toBe(0);
      expect((await runScheduledPass(store, mirror, () => ({}), date)).failed).toBe(0);
      const rows = await store.withAccount(id, client => client.query('SELECT count(*)::int AS n FROM dira_account_daily_reports WHERE account_id=$1', [id]));
      expect(rows.rows[0].n).toBe(2);
    } finally {
      if (previousIds === undefined) delete process.env.DIRA_DAILY_JOB_ACCOUNT_IDS;
      else process.env.DIRA_DAILY_JOB_ACCOUNT_IDS = previousIds;
    }
  });
  it('removes both durable memory and its local checkout when an account is deleted', async () => {
    const id = `demo-${randomUUID()}`; ids.push(id);
    await createDemoAccount(store, id, buildDemoWorld(id));
    await syncAccountMemory(id, async () => ({ state:await store.ensureDomainState(id), profile:undefined }));
    const hash = createHash('sha256').update(id).digest('hex');
    await deleteAccountData(store, id);
    expect(await store.getAccount(id)).toBeUndefined();
    const rows = await store.withAccount(id, client => client.query('SELECT account_id FROM dira_memory_bundles WHERE account_id=$1', [id]));
    expect(rows.rowCount).toBe(0);
    await expect(readFile(join(directory, hash, 'graph.json'))).rejects.toThrow();
  });
});

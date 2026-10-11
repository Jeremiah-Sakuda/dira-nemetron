import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { commitmentStakeholders, minutesToIso } from '@dira/commitment-model';
import type { ModelClient } from '@dira/agent';
import { PostgresAccountStore } from '../../services/orchestrator/src/postgres-store.js';
import { buildDemoWorld } from '../../services/orchestrator/src/demo-world.js';
import { createDemoAccount, deleteAccountData } from '../../services/orchestrator/src/account-records.js';
import { registerSourceCheck, runSourceCheck, webSourceId } from '../../services/orchestrator/src/source-checks.js';

const url = process.env.DIRA_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('official-source checks with Tavily', () => {
  let store: PostgresAccountStore;
  const created: string[] = [];

  beforeAll(async () => {
    delete process.env.NEBIUS_API_KEY;
    process.env.TAVILY_API_KEY = 'tvly-test';
    store = new PostgresAccountStore(new Pool({ connectionString: url, max: 6 }));
    await store.initialize();
  });
  afterAll(async () => {
    delete process.env.TAVILY_API_KEY;
    for (const id of created) await deleteAccountData(store, id).catch(() => undefined);
    await store?.close();
  });

  async function setup() {
    const accountId = `demo-${randomUUID()}`;
    const world = buildDemoWorld(accountId, new Date('2026-10-11T15:00:00Z'));
    await createDemoAccount(store, accountId, world);
    created.push(accountId);
    await registerSourceCheck(store, accountId, 'econ402-midterm-2', 'https://econ402.university.demo/exams');
    return { accountId, world };
  }

  const tavily = (results: { url: string; title: string; content: string }[]) => (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    expect(body.include_domains).toEqual(['econ402.university.demo']);
    return new Response(JSON.stringify({ results, response_time: 0.4, request_id: 'req-1' }), { status: 200 });
  }) as unknown as typeof fetch;

  function pageModel(newStartIso: string, quote: string): ModelClient {
    return {
      name: 'fixture-page',
      interpret: async () => ({
        relevant: true,
        reason: 'The official exam page lists a different time',
        mutation: {
          entity_type: 'commitment', entity_id: 'econ402-midterm-2', mutation_type: 'schedule_change',
          new_start: newStartIso, unchanged_constraints: [], confidence: 0.95, evidence_quote: quote,
        },
      }),
    };
  }

  it('the official page can move the exam, but can never be contacted', async () => {
    const { accountId, world } = await setup();
    const state = (await store.loadDomainState(accountId))!;
    expect(commitmentStakeholders(state, 'econ402-midterm-2')).not.toContain(webSourceId('econ402.university.demo'));
    const wednesday = minutesToIso(1440 + 14 * 60, world.horizonStartIso, 'America/Chicago');
    const quote = 'Midterm 2: Wednesday, 2:00 PM, Room 101';
    const result = await runSourceCheck(store, accountId, 'econ402-midterm-2', {
      fetchImpl: tavily([
        { url: 'https://econ402.university.demo/exams', title: 'ECON 402 exams', content: `Updated schedule. ${quote}.` },
        { url: 'https://elsewhere.example/econ402', title: 'Mirror', content: quote },
      ]),
      model: pageModel(wednesday, quote),
    });
    expect(result.considered.map((item) => item.status)).toEqual(['AWAITING_APPROVAL', 'SKIPPED']);
    expect(result.considered[1]!.reason).toContain('not on the official domain');
  });

  it('a page claim without a verbatim quote from the fetched text is held, not applied', async () => {
    const { accountId, world } = await setup();
    const before = (await store.loadDomainState(accountId))!.commitments['econ402-midterm-2']!.startMin;
    const result = await runSourceCheck(store, accountId, 'econ402-midterm-2', {
      fetchImpl: tavily([{ url: 'https://econ402.university.demo/news', title: 'News', content: 'Course news and office hours.' }]),
      model: pageModel(minutesToIso(1440 + 9 * 60, world.horizonStartIso, 'America/Chicago'), 'Midterm moved to Wednesday 9 AM'),
    });
    expect(result.considered[0]!.status).toBe('WAITING_REVIEW');
    expect((await store.loadDomainState(accountId))!.commitments['econ402-midterm-2']!.startMin).toBe(before);
  });
});

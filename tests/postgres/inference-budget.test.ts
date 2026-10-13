import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInferenceBudgetGuard, inferenceUsageSummary } from '../../services/orchestrator/src/inference-budget.js';
import { PostgresAccountStore } from '../../services/orchestrator/src/postgres-store.js';

const url = process.env.DIRA_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const request = { model: 'nvidia/nemotron-3-super-120b-a12b', requestBytes: 500, maxOutputTokens: 4096 };
const broad = { total: 100, daily: 100, hourly: 100, concurrent: 100 };

suite('durable deployment inference admission', () => {
  let store: PostgresAccountStore;
  let other: PostgresAccountStore;
  const scopes: string[] = [];
  const scope = () => { const value = `test-${randomUUID()}`; scopes.push(value); return value; };
  beforeAll(async () => {
    store = new PostgresAccountStore(new Pool({ connectionString: url, max: 5 }));
    other = new PostgresAccountStore(new Pool({ connectionString: url, max: 5 }));
    await store.initialize();
  });
  afterAll(async () => {
    if (store) await store.pool.query('DELETE FROM dira_inference_usage WHERE scope = ANY($1)', [scopes]);
    await store?.close(); await other?.close();
  });

  it('atomically admits one request across separate processes and survives a new guard', async () => {
    const name = scope(); const limits = { ...broad, total: 1 };
    const guards = [createInferenceBudgetGuard(async () => store, limits, name), createInferenceBudgetGuard(async () => other, limits, name)];
    const results = await Promise.allSettled(guards.map((guard) => guard(request)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const admitted = results.find((result) => result.status === 'fulfilled')!;
    if (admitted.status === 'fulfilled') await admitted.value.finish({ status: 'failed', httpStatus: 503 });
    await expect(createInferenceBudgetGuard(async () => other, limits, name)(request)).rejects.toThrow('total call limit');
  });

  it('enforces hourly and rolling daily windows independently', async () => {
    for (const window of ['hourly', 'daily'] as const) {
      const name = scope(); const guard = createInferenceBudgetGuard(async () => store, { ...broad, [window]: 1 }, name);
      await (await guard(request)).finish({ status: 'failed' });
      await expect(guard(request)).rejects.toThrow(`${window} call limit`);
      await store.pool.query(`UPDATE dira_inference_usage SET started_at = now() - interval '25 hours' WHERE scope = $1`, [name]);
      await expect(guard(request)).resolves.toBeDefined();
    }
  });

  it('releases concurrency on completion, but keeps stale or failed calls in total quota', async () => {
    const name = scope(); const guard = createInferenceBudgetGuard(async () => store, { ...broad, concurrent: 1 }, name);
    const first = await guard(request);
    await expect(guard(request)).rejects.toThrow('concurrent call limit');
    await first.finish({ status: 'completed', httpStatus: 200,
      telemetry: { model: request.model, provider: 'Nebius Token Factory', latencyMs: 100, promptTokens: 10, completionTokens: 20, totalTokens: 30 } });
    await guard(request);
    await store.pool.query(`UPDATE dira_inference_usage SET started_at = now() - interval '91 seconds' WHERE scope = $1 AND status = 'reserved'`, [name]);
    await guard(request);
    const summary = await inferenceUsageSummary(store, name);
    expect(summary.calls.total).toBe(3);
    expect(summary.reportedTokens).toBe(30);
    expect(summary.estimatedCostUsd).toBeCloseTo(0.000021, 8);
    expect(summary.unreportedCalls).toBe(2);
  });
});

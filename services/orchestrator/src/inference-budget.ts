import { randomUUID } from 'node:crypto';
import { estimateCostUsd, tierForModel, type ModelRequestGuard, type ModelRequestResult } from '@dira/agent';
import type { PostgresAccountStore } from './postgres-store.js';

export interface InferenceLimits {
  total: number;
  daily: number;
  hourly: number;
  concurrent: number;
}

export const INFERENCE_SCOPE = 'token-factory-v1';

export function inferenceLimits(): InferenceLimits {
  return {
    total: limit('DIRA_INFERENCE_MAX_CALLS_TOTAL', 100),
    daily: limit('DIRA_INFERENCE_MAX_CALLS_PER_DAY', 20),
    hourly: limit('DIRA_INFERENCE_MAX_CALLS_PER_HOUR', 12),
    concurrent: limit('DIRA_INFERENCE_MAX_CONCURRENT', 2),
  };
}

function limit(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > 10000) {
    throw new Error(`${name} must be an integer between 1 and 10000`);
  }
  return value;
}

interface Counts {
  total: number;
  daily: number;
  hourly: number;
  concurrent: number;
}

const countsSql = `SELECT count(*)::int AS total,
  count(*) FILTER (WHERE started_at >= now() - interval '24 hours')::int AS daily,
  count(*) FILTER (WHERE started_at >= now() - interval '1 hour')::int AS hourly,
  count(*) FILTER (WHERE status = 'reserved' AND started_at >= now() - interval '90 seconds')::int AS concurrent
  FROM dira_inference_usage WHERE scope = $1`;

/** All model clients in the service share this durable budget, across processes. */
export function createInferenceBudgetGuard(
  getStore: () => Promise<PostgresAccountStore>,
  limits = inferenceLimits(),
  scope = INFERENCE_SCOPE,
): ModelRequestGuard {
  return async (request) => {
    const tier = tierForModel(request.model);
    if (!tier) throw new Error('Live inference paused: this model has no configured routing tier.');
    const store = await getStore();
    const client = await store.pool.connect();
    const requestId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`dira-inference:${scope}`]);
      const { rows } = await client.query<Counts>(countsSql, [scope]);
      const counts = rows[0]!;
      const reached = (Object.keys(limits) as (keyof InferenceLimits)[]).find((key) => counts[key] >= limits[key]);
      if (reached) {
        throw new Error(`Live inference paused: ${reached} call limit reached. Stored replay remains available on the Evidence page.`);
      }
      await client.query(
        `INSERT INTO dira_inference_usage (request_id, scope, model, tier, request_bytes, max_output_tokens)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [requestId, scope, request.model, tier, request.requestBytes, request.maxOutputTokens],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return {
      async finish(result: ModelRequestResult) {
        const telemetry = result.telemetry;
        const prompt = tokenCount(telemetry?.promptTokens);
        const completion = tokenCount(telemetry?.completionTokens);
        await store.pool.query(
          `UPDATE dira_inference_usage SET finished_at = now(), status = $2, http_status = $3,
           prompt_tokens = $4, completion_tokens = $5, total_tokens = $6, latency_ms = $7, estimated_cost_usd = $8
           WHERE request_id = $1 AND status = 'reserved'`,
          [requestId, result.status, result.httpStatus ?? null, prompt, completion,
            tokenCount(telemetry?.totalTokens), tokenCount(telemetry?.latencyMs),
            prompt !== null && completion !== null ? estimateCostUsd(tier, prompt, completion) : null],
        );
      },
    };
  };
}

function tokenCount(value: number | undefined): number | null {
  return Number.isSafeInteger(value) && value! >= 0 && value! <= 2147483647 ? value! : null;
}

export async function inferenceUsageSummary(store: PostgresAccountStore, scope = INFERENCE_SCOPE) {
  const [counts, usage, windows] = await Promise.all([
    store.pool.query<Counts>(countsSql, [scope]),
    store.pool.query<{ reported_tokens: string; estimated_cost_usd: string; unreported_calls: number }>(
      `SELECT coalesce(sum(total_tokens), 0)::text AS reported_tokens,
       coalesce(sum(estimated_cost_usd), 0)::text AS estimated_cost_usd,
       count(*) FILTER (WHERE estimated_cost_usd IS NULL)::int AS unreported_calls
       FROM dira_inference_usage WHERE scope = $1`, [scope]),
    store.pool.query<{ started_at: Date; status: string }>(
      `SELECT started_at, status FROM dira_inference_usage WHERE scope=$1 AND started_at >= now()-interval '24 hours' ORDER BY started_at`, [scope]),
  ]);
  const limits = inferenceLimits();
  return { limits, calls: counts.rows[0]!, availability: inferenceAvailability(limits, counts.rows[0]!, windows.rows),
    reportedTokens: Number(usage.rows[0]!.reported_tokens),
    estimatedCostUsd: Number(usage.rows[0]!.estimated_cost_usd),
    unreportedCalls: usage.rows[0]!.unreported_calls,
    disclosure: 'Call limits are enforced locally. Cost is estimated from reported usage, not a provider invoice or a hard dollar cap.',
  };
}

export function inferenceAvailability(limits: InferenceLimits, counts: Counts,
  rows: { started_at: Date; status: string }[], now = Date.now()) {
  const reached = (Object.keys(limits) as (keyof InferenceLimits)[]).filter(key => counts[key] >= limits[key]);
  if (!reached.length) return { available: true, reason: 'Deployment call allowance is available.', resetsAtIso: null };
  if (reached.includes('total')) return { available: false, reason: 'The deployment’s total inference allowance is used. The credential-free replay remains available; this limit needs an operator decision.', resetsAtIso: null };
  const resetTimes = reached.map(key => {
    const duration = key === 'daily' ? 86400000 : key === 'hourly' ? 3600000 : 90000;
    const cohort = rows.filter(row => row.started_at.getTime() >= now - duration && (key !== 'concurrent' || row.status === 'reserved'));
    const boundary = cohort[Math.max(0, counts[key] - limits[key])];
    return boundary ? boundary.started_at.getTime() + duration : undefined;
  });
  return { available: false, reason: `Live inference is paused at the ${reached.join(' and ')} call allowance. Use the credential-free replay while it resets.`,
    resetsAtIso: resetTimes.every(time => time !== undefined) ? new Date(Math.max(...resetTimes as number[])).toISOString() : null };
}

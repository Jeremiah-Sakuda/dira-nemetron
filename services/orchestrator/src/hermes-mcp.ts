import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { computeFeasibility } from '@dira/constraint-engine';
import { minutesToIso } from '@dira/commitment-model';
import { listFlightRecords, listRecentWorkflows } from './account-records.js';
import { listRules } from './account-rules.js';
import type { PostgresAccountStore } from './postgres-store.js';

/**
 * Dira as a tool server for Hermes Agent (deployed through NemoClaw).
 *
 * Transport: MCP Streamable HTTP, answered with single JSON responses
 * (NemoClaw accepts only HTTPS MCP servers). Auth: a per-account bearer token
 * the owner creates in Settings; only its SHA-256 is stored.
 *
 * Every tool reads and reports. `dira_relay_change` stores the owner's words
 * as a pending note; nothing reaches the repair engine until the owner
 * confirms it in the authenticated web app. No tool can approve an action,
 * confirm a graph change, change policy, or send a message.
 */

const PROTOCOL_VERSION = '2025-06-18';

export const HERMES_TOOLS = [
  {
    name: 'dira_status',
    description: 'Current schedule health: global slack, broken constraints, and how many actions wait for the owner. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'dira_upcoming',
    description: 'The owner\'s next commitments with times and deadlines from Dira\'s confirmed graph. Read-only.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 25 } }, additionalProperties: false },
  },
  {
    name: 'dira_pending_approvals',
    description: 'Actions Dira is holding for the owner\'s approval. You cannot approve them; tell the owner to use the Telegram buttons or the web inbox. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'dira_explain_last_run',
    description: 'What Dira did in its most recent repair, as its flight record (interpretation, proposals, policy verdicts, verification). Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'dira_rules',
    description: 'Rules the owner confirmed after correcting Dira. Dira enforces them; you cannot change them. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'dira_relay_change',
    description: 'Relay a change the owner just told you about (for example "my ECE midterm moved to Wednesday 2pm"). Dira stores it for the owner to confirm in the web app; nothing changes until they do.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', minLength: 3, maxLength: 1000, description: 'The owner\'s words, verbatim.' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
] as const;

export async function createHermesToken(store: PostgresAccountStore, accountId: string): Promise<string> {
  const token = `dira_h_${randomBytes(32).toString('base64url')}`;
  await store.pool.query('DELETE FROM dira_hermes_tokens WHERE account_id = $1', [accountId]);
  await store.pool.query('INSERT INTO dira_hermes_tokens (token_hash, account_id) VALUES ($1, $2)', [hash(token), accountId]);
  return token;
}

export async function revokeHermesTokens(store: PostgresAccountStore, accountId: string): Promise<void> {
  await store.pool.query('DELETE FROM dira_hermes_tokens WHERE account_id = $1', [accountId]);
}

export async function hermesTokenStatus(store: PostgresAccountStore, accountId: string) {
  const result = await store.pool.query<{ created_at: Date; last_used_at: Date | null }>(
    'SELECT created_at, last_used_at FROM dira_hermes_tokens WHERE account_id = $1', [accountId]);
  const row = result.rows[0];
  return row ? { createdAtIso: row.created_at.toISOString(), lastUsedAtIso: row.last_used_at?.toISOString() ?? null } : null;
}

async function accountForToken(store: PostgresAccountStore, header: string | undefined): Promise<string | undefined> {
  const token = /^Bearer\s+(dira_h_[A-Za-z0-9_-]{20,})$/.exec(header ?? '')?.[1];
  if (!token) return undefined;
  const result = await store.pool.query<{ account_id: string }>(
    'UPDATE dira_hermes_tokens SET last_used_at = now() WHERE token_hash = $1 RETURNING account_id', [hash(token)]);
  return result.rows[0]?.account_id;
}

interface JsonRpcRequest { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> }

export async function handleHermesMcp(
  req: IncomingMessage,
  res: ServerResponse,
  store: PostgresAccountStore,
  body: string,
): Promise<void> {
  const reply = (code: number, payload: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
    res.end(payload === undefined ? '' : JSON.stringify(payload));
  };
  if (req.method === 'GET') { reply(405, { error: 'Use POST for MCP requests.' }, { allow: 'POST' }); return; }
  const accountId = await accountForToken(store, req.headers.authorization);
  if (!accountId) { reply(401, { error: 'invalid or missing Dira Hermes token' }, { 'www-authenticate': 'Bearer' }); return; }

  let message: JsonRpcRequest | JsonRpcRequest[];
  try {
    message = JSON.parse(body) as JsonRpcRequest | JsonRpcRequest[];
  } catch {
    reply(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  const batch = Array.isArray(message) ? message : [message];
  const results = [];
  for (const request of batch) {
    const result = await dispatch(store, accountId, request);
    if (request.id !== undefined && request.id !== null) results.push(result);
  }
  if (!results.length) { reply(202, undefined); return; }
  reply(200, Array.isArray(message) ? results : results[0], { 'mcp-session-id': `dira-${accountId.slice(-8)}` });
}

async function dispatch(store: PostgresAccountStore, accountId: string, request: JsonRpcRequest) {
  const id = request.id ?? null;
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  try {
    switch (request.method) {
      case 'initialize':
        return ok({
          protocolVersion: typeof request.params?.protocolVersion === 'string' ? request.params.protocolVersion : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'dira', version: '2.0.0' },
          instructions: 'Dira keeps the owner\'s commitments feasible. Its tools are read-and-report. Approvals happen only through the owner\'s Telegram buttons or the web inbox, never through you.',
        });
      case 'notifications/initialized':
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: HERMES_TOOLS });
      case 'tools/call': {
        const name = String(request.params?.name ?? '');
        const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
        const text = await callTool(store, accountId, name, args);
        return ok({ content: [{ type: 'text', text }], isError: false });
      }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${request.method}` } };
    }
  } catch (error) {
    return ok({ content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true });
  }
}

export async function callTool(store: PostgresAccountStore, accountId: string, name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'dira_status': {
      const [state, approvals, runs] = await Promise.all([
        store.loadDomainState(accountId), store.listPendingApprovals(accountId), listRecentWorkflows(store, accountId, 1),
      ]);
      if (!state) return 'Dira has no commitment graph for this account yet.';
      const feasibility = computeFeasibility(state);
      return JSON.stringify({
        globalSlackMinutes: feasibility.global_slack_minutes,
        brokenConstraints: feasibility.violations.map((violation) => violation.detail),
        actionsWaitingForOwner: approvals.length,
        lastRun: runs[0] ? { status: runs[0].status, summary: runs[0].mutationSummary ?? null } : null,
      });
    }
    case 'dira_upcoming': {
      const state = await store.loadDomainState(accountId);
      if (!state) return '[]';
      const limit = Math.min(25, Math.max(1, Number(args.limit ?? 10) || 10));
      const nowMin = Math.round((Date.now() - Date.parse(state.horizonStartIso)) / 60_000);
      const items = Object.values(state.commitments)
        .filter((item) => item.status !== 'DROPPED' && !item.reservesEffortFor)
        .map((item) => ({ item, at: item.startMin ?? item.deadlineMin }))
        .filter((entry): entry is { item: typeof entry.item; at: number } => entry.at !== undefined && entry.at >= Math.min(nowMin, 0))
        .sort((a, b) => a.at - b.at)
        .slice(0, limit)
        .map(({ item, at }) => ({
          title: item.title,
          [item.kind === 'effort' ? 'due' : 'starts']: minutesToIso(at, state.horizonStartIso, state.timezone),
          flexibility: item.flexibility,
        }));
      return JSON.stringify(items);
    }
    case 'dira_pending_approvals': {
      const approvals = await store.listPendingApprovals(accountId);
      return JSON.stringify({
        note: 'Only the owner can approve, using Telegram buttons or the Dira web inbox.',
        pending: approvals.map((record) => ({ summary: record.action.summary, rule: record.policyRule })),
      });
    }
    case 'dira_explain_last_run': {
      const [run] = await listRecentWorkflows(store, accountId, 1);
      if (!run) return 'Dira has not run a repair for this account yet.';
      const flight = await listFlightRecords(store, accountId, run.id);
      return JSON.stringify({
        status: run.status, summary: run.mutationSummary ?? null, reason: run.statusReason ?? null,
        flight: flight.slice(-40).map((line) => `${line.phase}: ${line.message}`),
      });
    }
    case 'dira_rules': {
      const rules = await listRules(store, accountId);
      return JSON.stringify({ confirmed: rules.confirmed.map((rule) => rule.sentence), awaitingOwner: rules.candidates.length });
    }
    case 'dira_relay_change': {
      const text = String(args.text ?? '').trim().slice(0, 1000);
      if (text.length < 3) throw new Error('Describe the change in a few words.');
      const noteId = `note-${randomUUID()}`;
      await store.withAccount(accountId, async (client) => {
        await client.query(
          `INSERT INTO dira_user_notes (account_id, note_id, text, source, status) VALUES ($1, $2, $3, 'hermes', 'PENDING')`,
          [accountId, noteId, text],
        );
      });
      return 'Saved for the owner to confirm in Dira. Nothing has changed yet; once they confirm, Dira will interpret it and plan a repair.';
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresAccountStore } from '../../services/orchestrator/src/postgres-store.js';
import { buildDemoWorld } from '../../services/orchestrator/src/demo-world.js';
import { createDemoAccount, deleteAccountData, readExecutionSurfaces } from '../../services/orchestrator/src/account-records.js';
import { handleAccountEmail } from '../../services/orchestrator/src/account-repair.js';
import { createHermesToken, handleHermesMcp, HERMES_TOOLS } from '../../services/orchestrator/src/hermes-mcp.js';
import { createTelegramLink, handleTelegramUpdate, notifyApprovalRequested } from '../../services/orchestrator/src/telegram.js';

const url = process.env.DIRA_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('Hermes tools and Telegram approvals', () => {
  let store: PostgresAccountStore;
  const created: string[] = [];
  const telegramCalls: { method: string; body: Record<string, unknown> }[] = [];
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    delete process.env.NEBIUS_API_KEY;
    process.env.DIRA_TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.DIRA_TELEGRAM_WEBHOOK_SECRET = 'test-secret';
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const target = String(input instanceof Request ? input.url : input);
      if (target.startsWith('https://api.telegram.org/')) {
        telegramCalls.push({ method: target.split('/').pop()!, body: JSON.parse(String(init?.body ?? '{}')) });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    store = new PostgresAccountStore(new Pool({ connectionString: url, max: 6 }));
    await store.initialize();
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
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

  async function mcp(token: string | undefined, payload: unknown) {
    const req = Object.assign(new EventEmitter(), {
      method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {},
    }) as unknown as IncomingMessage;
    let status = 0;
    let text = '';
    const res = {
      writeHead(code: number) { status = code; return this; },
      end(body?: string) { text = body ?? ''; },
    } as unknown as ServerResponse;
    await handleHermesMcp(req, res, store, JSON.stringify(payload));
    return { status, body: text ? JSON.parse(text) : undefined };
  }

  it('exposes read-and-report tools only and relays changes for owner confirmation', async () => {
    const { accountId } = await newDemo();
    expect(HERMES_TOOLS.map((tool) => tool.name).some((name) => /approve|confirm|send|delete|execute/i.test(name))).toBe(false);
    expect((await mcp(undefined, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
    const token = await createHermesToken(store, accountId);
    const init = await mcp(token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    expect(init.body.result.serverInfo.name).toBe('dira');
    const status = await mcp(token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'dira_status', arguments: {} } });
    expect(JSON.parse(status.body.result.content[0].text).globalSlackMinutes).toBe(246);
    const relay = await mcp(token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'dira_relay_change', arguments: { text: 'my long run moved to Sunday' } } });
    expect(relay.body.result.content[0].text).toContain('Nothing has changed yet');
    const notes = await store.withAccount(accountId, (client) => client.query("SELECT status FROM dira_user_notes WHERE account_id = $1", [accountId]));
    expect(notes.rows).toEqual([{ status: 'PENDING' }]);
    const approve = await mcp(token, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'dira_approve', arguments: {} } });
    expect(approve.body.result.isError).toBe(true);
    // A notification without an id gets a 202 and no body.
    expect((await mcp(token, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
  });

  it('approves through a nonce-checked Telegram button bound to the linked chat', async () => {
    const { accountId, world } = await newDemo();
    const link = await createTelegramLink(store, accountId);
    await handleTelegramUpdate(store, { message: { chat: { id: 4242 }, text: `/start ${link.code}` } }, () => ({}));
    const run = await handleAccountEmail(store, accountId, world.presets[0]!.email, {
      onAwaitingApproval: (paused, pending) => notifyApprovalRequested(store, accountId, paused, pending),
    });
    expect(run.run.status).toBe('AWAITING_APPROVAL');
    const prompt = telegramCalls.find((call) => call.method === 'sendMessage' && call.body.reply_markup)!;
    const buttons = (prompt.body.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0]!;
    const approveData = buttons.find((button) => button.callback_data.startsWith('a:'))!.callback_data;
    expect(Buffer.byteLength(approveData)).toBeLessThanOrEqual(64);

    // The same button from a different chat is refused.
    await handleTelegramUpdate(store, { callback_query: { id: 'q1', data: approveData, message: { chat: { id: 999 }, message_id: 1 } } }, () => ({}));
    expect(String(telegramCalls.at(-1)!.body.text)).toContain('expired or was already used');
    expect((await store.listPendingApprovals(accountId))).toHaveLength(1);

    await handleTelegramUpdate(store, { callback_query: { id: 'q2', data: approveData, message: { chat: { id: 4242 }, message_id: 2 } } }, () => ({}));
    const surfaces = await readExecutionSurfaces(store, accountId);
    expect(surfaces.delegations.find((task) => task.taskId === 'org-task-visual-qa')!.owner).toBe('maya-okafor');
    const decision = await store.withAccount(accountId, (client) => client.query('SELECT source FROM dira_action_approvals WHERE account_id = $1', [accountId]));
    expect(decision.rows[0].source).toBe('telegram-callback');

    // Replaying the button does nothing.
    await handleTelegramUpdate(store, { callback_query: { id: 'q3', data: approveData, message: { chat: { id: 4242 }, message_id: 2 } } }, () => ({}));
    expect(String(telegramCalls.at(-1)!.body.text)).toContain('expired or was already used');
  });
});

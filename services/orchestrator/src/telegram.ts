import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ActionRecord } from '@dira/action-ledger';
import type { WorkflowRun } from '@dira/agent';
import { recordOwnerDecision } from './account-records.js';
import { resumeAccountRepair, workflowReadyToResume, type AccountRepairOptions } from './account-repair.js';
import type { PostgresAccountStore } from './postgres-store.js';

/**
 * Dira's approval bot. Hermes is the conversational surface, but its own
 * approvals are text replies a model reads; Dira's approvals never pass
 * through a model. This bot sends inline Approve/Reject buttons whose
 * callback data is a single-use nonce bound to one action, one decision and
 * the linked chat. The webhook checks Telegram's secret-token header, the
 * nonce, its expiry and the chat before recording a 'telegram-callback'
 * decision, then resumes the plan through the normal revalidating engine.
 */

const NONCE_TTL_MS = 24 * 60 * 60 * 1000;
const LINK_TTL_MS = 15 * 60 * 1000;

export function telegramConfigured(): boolean {
  return Boolean(process.env.DIRA_TELEGRAM_BOT_TOKEN && process.env.DIRA_TELEGRAM_WEBHOOK_SECRET);
}

export async function createTelegramLink(store: PostgresAccountStore, accountId: string): Promise<{ url: string; code: string; expiresAtIso: string }> {
  if (!telegramConfigured()) throw new Error('Telegram approvals are not configured on this deployment.');
  const code = randomBytes(12).toString('hex');
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  await store.pool.query('DELETE FROM dira_telegram_link_codes WHERE account_id = $1 OR expires_at < now()', [accountId]);
  await store.pool.query('INSERT INTO dira_telegram_link_codes (code_hash, account_id, expires_at) VALUES ($1, $2, $3)', [hash(code), accountId, expiresAt]);
  const bot = process.env.DIRA_TELEGRAM_BOT_USERNAME ?? 'DiraApprovalsBot';
  return { url: `https://t.me/${bot}?start=${code}`, code, expiresAtIso: expiresAt.toISOString() };
}

export async function telegramLinkStatus(store: PostgresAccountStore, accountId: string) {
  const result = await store.pool.query<{ linked_at: Date }>('SELECT linked_at FROM dira_telegram_links WHERE account_id = $1', [accountId]);
  return { configured: telegramConfigured(), linked: Boolean(result.rows[0]), linkedAtIso: result.rows[0]?.linked_at.toISOString() ?? null };
}

export async function unlinkTelegram(store: PostgresAccountStore, accountId: string): Promise<void> {
  await store.pool.query('DELETE FROM dira_telegram_links WHERE account_id = $1', [accountId]);
  await store.pool.query('DELETE FROM dira_telegram_nonces WHERE account_id = $1', [accountId]);
}

async function chatFor(store: PostgresAccountStore, accountId: string): Promise<string | undefined> {
  const result = await store.pool.query<{ chat_id: string }>('SELECT chat_id FROM dira_telegram_links WHERE account_id = $1', [accountId]);
  return result.rows[0]?.chat_id;
}

/** Send one message per held action, each with its own Approve/Reject nonces. */
export async function notifyApprovalRequested(
  store: PostgresAccountStore,
  accountId: string,
  run: WorkflowRun,
  pending: ActionRecord[],
): Promise<void> {
  if (!telegramConfigured() || !pending.length) return;
  const chatId = await chatFor(store, accountId);
  if (!chatId) return;
  for (const record of pending) {
    const approve = await issueNonce(store, accountId, chatId, record.actionId, 'APPROVED');
    const reject = await issueNonce(store, accountId, chatId, record.actionId, 'REJECTED');
    const text = [
      'Dira needs your OK',
      '',
      record.action.summary,
      run.mutationSummary ? `Because: ${run.mutationSummary}` : '',
      `Policy: ${record.policyRule.replaceAll('-', ' ')}`,
      '',
      'Approving re-checks your schedule before anything runs.',
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
    await telegram('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: [[
        { text: 'Approve', callback_data: `a:${approve}` },
        { text: 'Reject', callback_data: `r:${reject}` },
      ]] },
    });
  }
}

export async function sendTelegramText(store: PostgresAccountStore, accountId: string, text: string): Promise<boolean> {
  if (!telegramConfigured()) return false;
  const chatId = await chatFor(store, accountId);
  if (!chatId) return false;
  await telegram('sendMessage', { chat_id: chatId, text: text.slice(0, 4000) });
  return true;
}

async function issueNonce(store: PostgresAccountStore, accountId: string, chatId: string, actionId: string, decision: 'APPROVED' | 'REJECTED'): Promise<string> {
  const nonce = randomBytes(18).toString('base64url');
  await store.pool.query(
    `INSERT INTO dira_telegram_nonces (nonce_hash, account_id, chat_id, action_id, decision, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [hash(nonce), accountId, chatId, actionId, decision, new Date(Date.now() + NONCE_TTL_MS)],
  );
  return nonce;
}

interface TelegramUpdate {
  message?: { chat?: { id?: number | string }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat?: { id?: number | string }; message_id?: number } };
}

export function verifyTelegramSecret(req: IncomingMessage): boolean {
  const expected = process.env.DIRA_TELEGRAM_WEBHOOK_SECRET ?? '';
  const supplied = String(req.headers['x-telegram-bot-api-secret-token'] ?? '');
  if (!expected || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function handleTelegramUpdate(
  store: PostgresAccountStore,
  update: TelegramUpdate,
  repairOptions: (accountId: string) => AccountRepairOptions,
): Promise<void> {
  const text = update.message?.text?.trim();
  const messageChat = update.message?.chat?.id;
  if (text && messageChat !== undefined) {
    const code = /^\/start\s+([0-9a-f]{24})$/.exec(text)?.[1];
    if (code) {
      const claimed = await store.pool.query<{ account_id: string }>(
        'DELETE FROM dira_telegram_link_codes WHERE code_hash = $1 AND expires_at > now() RETURNING account_id', [hash(code)]);
      const accountId = claimed.rows[0]?.account_id;
      if (!accountId) {
        await telegram('sendMessage', { chat_id: messageChat, text: 'That link has expired. Create a new one in Dira Settings.' });
        return;
      }
      await store.pool.query('DELETE FROM dira_telegram_links WHERE chat_id = $1', [String(messageChat)]);
      await store.pool.query(
        `INSERT INTO dira_telegram_links (account_id, chat_id) VALUES ($1, $2)
         ON CONFLICT (account_id) DO UPDATE SET chat_id = EXCLUDED.chat_id, linked_at = now()`,
        [accountId, String(messageChat)],
      );
      await telegram('sendMessage', { chat_id: messageChat, text: 'Linked. Dira will send approval requests and your morning summary here. Buttons work only from this chat.' });
    }
    return;
  }

  const callback = update.callback_query;
  if (!callback?.data) return;
  const match = /^([ar]):([A-Za-z0-9_-]{20,40})$/.exec(callback.data);
  const chatId = callback.message?.chat?.id;
  if (!match || chatId === undefined) {
    await telegram('answerCallbackQuery', { callback_query_id: callback.id, text: 'Unrecognized button.' });
    return;
  }
  const decision = match[1] === 'a' ? 'APPROVED' : 'REJECTED';
  const used = await store.pool.query<{ account_id: string; action_id: string }>(
    `UPDATE dira_telegram_nonces SET used_at = now()
     WHERE nonce_hash = $1 AND used_at IS NULL AND expires_at > now() AND chat_id = $2 AND decision = $3
     RETURNING account_id, action_id`,
    [hash(match[2]!), String(chatId), decision],
  );
  const row = used.rows[0];
  if (!row) {
    await telegram('answerCallbackQuery', { callback_query_id: callback.id, text: 'This button has expired or was already used.', show_alert: true });
    return;
  }
  // The sibling button for the same action is now void too.
  await store.pool.query('UPDATE dira_telegram_nonces SET used_at = now() WHERE action_id = $1 AND account_id = $2 AND used_at IS NULL', [row.action_id, row.account_id]);
  let outcome: string;
  try {
    const record = await recordOwnerDecision(store, row.account_id, row.action_id, decision, 'telegram-callback');
    outcome = decision === 'APPROVED' ? 'Approved.' : 'Rejected. Nothing in that plan will run.';
    if (await workflowReadyToResume(store, row.account_id, record.workflowId)) {
      const resumed = await resumeAccountRepair(store, row.account_id, record.workflowId, repairOptions(row.account_id));
      outcome += resumed.run.status === 'RESOLVED'
        ? ' Dira re-checked your schedule, ran the plan, and verified every change.'
        : ` Plan status: ${resumed.run.status.toLowerCase().replaceAll('_', ' ')}. ${resumed.run.statusReason ?? ''}`;
    }
  } catch (error) {
    outcome = `Could not record that: ${error instanceof Error ? error.message : String(error)}`;
  }
  await telegram('answerCallbackQuery', { callback_query_id: callback.id, text: outcome.slice(0, 190) });
  if (callback.message?.message_id) {
    await telegram('editMessageReplyMarkup', { chat_id: chatId, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
    await telegram('sendMessage', { chat_id: chatId, text: outcome });
  }
}

async function telegram(method: string, payload: Record<string, unknown>): Promise<void> {
  const token = process.env.DIRA_TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  }).catch((error: unknown) => error);
  if (!(response instanceof Response) || !response.ok) {
    console.error(JSON.stringify({ severity: 'WARN', msg: 'telegram call failed', method, status: response instanceof Response ? response.status : String(response) }));
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

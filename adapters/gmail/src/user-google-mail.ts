import { createHash } from 'node:crypto';
import { google } from 'googleapis';
import {
  ToolError,
  type GmailMessage,
  type GmailTool,
  type OutboundMessageOptions,
  type OutboundVerifyOptions,
} from '@dira/tool-contracts';

export const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export interface OutboundMailGuard {
  /** Exact stored addresses Dira may write to right now (stakeholders of the account graph). */
  allowedRecipients(): Promise<ReadonlySet<string>>;
  /** Draft-only is a per-account policy; true keeps every message in Drafts. */
  draftOnly(): Promise<boolean>;
  /** Display name used in the mandatory disclosure line. */
  ownerName(): Promise<string>;
  ownerEmail(): Promise<string>;
}

/**
 * Outbound Gmail adapter. Requires gmail.compose (draft or send) plus
 * gmail.readonly (independent read-back). Every message carries a
 * deterministic Message-ID derived from thread, recipient and body, so a
 * crash between send and verification can be recovered by searching for that
 * id instead of sending twice. Recipients are checked again here, after
 * policy, against the account's stored stakeholder addresses.
 */
export class GoogleUserMailTool implements GmailTool {
  constructor(
    private readonly getAccessToken: () => Promise<string>,
    private readonly guard: OutboundMailGuard,
    private readonly scopes: () => Promise<readonly string[]>,
  ) {}

  private async client() {
    const granted = await this.scopes();
    if (!granted.includes(GMAIL_COMPOSE_SCOPE) || !granted.includes(GMAIL_READONLY_SCOPE)) {
      throw new ToolError('Gmail drafting permission has not been granted for this account', 'INSUFFICIENT_SCOPE', false);
    }
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: await this.getAccessToken() });
    return google.gmail({ version: 'v1', auth });
  }

  async readMessage(): Promise<GmailMessage | null> {
    return null; // intake reads go through GoogleUserGmailTool's bounded sync path
  }

  async readThread(): Promise<GmailMessage[]> {
    return [];
  }

  async sendReply(threadId: string, to: string, body: string, options: OutboundMessageOptions = {}): Promise<{ messageId: string; mode: 'sent' | 'draft' }> {
    const recipient = to.trim().toLowerCase();
    if (!(await this.guard.allowedRecipients()).has(recipient)) {
      throw new ToolError(`recipient ${recipient} is not a stored stakeholder`, 'RECIPIENT_NOT_ALLOWED', false);
    }
    const api = await this.client();
    const draftOnly = await this.guard.draftOnly();
    const messageId = deterministicMessageId(threadId, recipient, body);
    const subject = options.subject ?? 'Update from Dira';
    const expected = { to: recipient, body, subject };
    const existing = await this.findExisting(api, messageId, draftOnly, expected);
    if (existing) return { messageId: existing, mode: draftOnly ? 'draft' : 'sent' };
    const raw = await this.raw(recipient, body, subject, messageId);
    const gmailThreadId = /^[0-9a-f]{16}$/.test(threadId) ? threadId : undefined;
    try {
      if (draftOnly) {
        const created = await api.users.drafts.create({
          userId: 'me',
          requestBody: { message: { raw, ...(gmailThreadId ? { threadId: gmailThreadId } : {}) } },
        });
        return { messageId: created.data.message?.id ?? messageId, mode: 'draft' };
      }
      const sent = await api.users.messages.send({
        userId: 'me',
        requestBody: { raw, ...(gmailThreadId ? { threadId: gmailThreadId } : {}) },
      });
      return { messageId: sent.data.id ?? messageId, mode: 'sent' };
    } catch (error) {
      throw asToolError(error, draftOnly ? 'drafts.create' : 'messages.send');
    }
  }

  async verifyReply(threadId: string, bodyContains: string, options: OutboundVerifyOptions = {}): Promise<boolean> {
    if (!options.to || !options.body) return false;
    const api = await this.client();
    const draftOnly = await this.guard.draftOnly();
    const key = deterministicMessageId(threadId, options.to.trim().toLowerCase(), options.body);
    const id = options.messageId ?? await this.findExisting(api, key, draftOnly, options);
    if (!id) return false;
    try {
      const message = await api.users.messages.get({ userId: 'me', id, format: 'full' });
      return await this.matches(message.data, key, draftOnly, options, Boolean(options.messageId))
        && decodeBody(message.data.payload).includes(bodyContains);
    } catch (error) {
      throw asToolError(error, 'messages.get');
    }
  }

  /** Gmail rewrites RFC Message-ID on drafts. Search only the expected recipient
   * and subject, then inspect our preserved header and full content. This also
   * recovers after a create response was lost; never resend on an incomplete scan. */
  private async findExisting(
    api: ReturnType<typeof google.gmail>, key: string, draftOnly: boolean,
    expected: OutboundVerifyOptions,
  ): Promise<string | undefined> {
    const exact = await this.findByMessageId(api, key, draftOnly);
    if (exact) {
      const read = await api.users.messages.get({ userId: 'me', id: exact, format: 'full' });
      if (await this.matches(read.data, key, draftOnly, expected)) return exact;
    }
    if (!expected.to || !expected.body || !expected.subject) return undefined;
    const quote = (s: string) => '"' + s.replace(/["\\\r\n]/g, ' ') + '"';
    try {
      const listed = await api.users.messages.list({ userId: 'me', maxResults: 100,
        q: `${draftOnly ? 'in:drafts' : 'in:sent'} to:${quote(expected.to)} subject:${quote(expected.subject)}`,
      });
      for (const candidate of listed.data.messages ?? []) {
        if (!candidate.id) continue;
        const read = await api.users.messages.get({ userId: 'me', id: candidate.id, format: 'full' });
        if (await this.matches(read.data, key, draftOnly, expected)) return candidate.id;
      }
      if (listed.data.nextPageToken) throw new ToolError('Gmail recovery search exceeded its bound; refusing to create another message', 'RECOVERY_SEARCH_INCOMPLETE', false);
      return undefined;
    } catch (error) { throw asToolError(error, 'targeted recovery read'); }
  }

  private async matches(
    message: { labelIds?: string[] | null; payload?: MailPart | null }, key: string,
    draftOnly: boolean, expected: OutboundVerifyOptions, durableReceipt = false,
  ): Promise<boolean> {
    if (!expected.to || !expected.body) return false;
    const labels = message.labelIds ?? [];
    if (!labels.includes(draftOnly ? 'DRAFT' : 'SENT') || (draftOnly && labels.includes('SENT'))) return false;
    const headers = message.payload?.headers ?? [];
    const values = (name: string) => headers.filter(h => h.name?.toLowerCase() === name).map(h => h.value ?? '');
    // One exact address; reject extra recipients, cc and bcc.
    const to = values('to');
    if (to.length !== 1 || to[0]!.trim().toLowerCase() !== expected.to.trim().toLowerCase()
      || values('cc').some(Boolean) || values('bcc').some(Boolean)) return false;
    if (expected.subject && values('subject')[0] !== expected.subject) return false;
    const disclosed = withDisclosure(expected.body, await this.guard.ownerName());
    if (decodeBody(message.payload).replace(/\r\n/g, '\n').trim() !== disclosed.replace(/\r\n/g, '\n').trim()) return false;
    const storedKey = values('x-dira-idempotency-key')[0];
    if (storedKey) return storedKey === key;
    if (values('message-id')[0] === `<${key}>`) return true;
    // Compatibility for already-created drafts from the old adapter. Only a
    // durable receipt or exact full content plus our disclosure marker qualifies.
    return values('x-dira-sent-on-behalf')[0] === 'true'
      && (durableReceipt || Boolean(expected.subject));
  }

  private async findByMessageId(api: ReturnType<typeof google.gmail>, messageId: string, draftOnly: boolean): Promise<string | undefined> {
    try {
      const listed = await api.users.messages.list({
        userId: 'me',
        q: `${draftOnly ? 'in:drafts ' : 'in:sent '}rfc822msgid:${messageId}`,
        maxResults: 1,
      });
      return listed.data.messages?.[0]?.id ?? undefined;
    } catch (error) {
      throw asToolError(error, 'messages.list');
    }
  }

  private async raw(to: string, body: string, subject: string, messageId: string): Promise<string> {
    const owner = await this.guard.ownerName();
    const from = await this.guard.ownerEmail();
    const disclosed = withDisclosure(body, owner);
    const lines = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${encodeHeader(subject)}`,
      `Message-ID: <${messageId}>`,
      `X-Dira-Idempotency-Key: ${messageId}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      'X-Dira-Sent-On-Behalf: true',
      '',
      disclosed,
    ];
    return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
  }
}

/** Every outbound message identifies itself as Dira acting for the owner. */
export function withDisclosure(body: string, ownerName: string): string {
  return /\bDira\b/.test(body)
    ? body
    : `${body}\n\n— Sent by Dira, an assistant acting on behalf of ${ownerName}.`;
}

export function deterministicMessageId(threadId: string, to: string, body: string): string {
  const digest = createHash('sha256').update(`${threadId}\n${to}\n${body}`).digest('hex').slice(0, 32);
  return `dira-${digest}@dira.local`;
}

function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ').slice(0, 200);
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

interface MailPart { mimeType?: string | null; body?: { data?: string | null } | null; parts?: MailPart[] | null; headers?: { name?: string | null; value?: string | null }[] | null }

function decodeBody(part: MailPart | undefined | null): string {
  if (!part) return '';
  if (part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
  return (part.parts ?? []).map(decodeBody).join('\n');
}

function asToolError(error: unknown, operation: string): ToolError {
  if (error instanceof ToolError) return error;
  const value = error as { code?: number; message?: string };
  const status = typeof value.code === 'number' ? value.code : 0;
  return new ToolError(
    `Gmail ${operation} failed: ${value.message ?? String(error)}`,
    `HTTP_${status || 'ERR'}`,
    status === 401 || status === 429 || status >= 500,
  );
}

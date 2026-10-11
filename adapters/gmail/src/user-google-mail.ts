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
    const existing = await this.findByMessageId(api, messageId, draftOnly);
    if (existing) return { messageId: existing, mode: draftOnly ? 'draft' : 'sent' };
    const raw = await this.raw(recipient, body, options.subject ?? 'Update from Dira', messageId);
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
    const id = await this.findByMessageId(api, deterministicMessageId(threadId, options.to.trim().toLowerCase(), options.body), draftOnly);
    if (!id) return false;
    try {
      const message = await api.users.messages.get({ userId: 'me', id, format: 'full' });
      const labels = message.data.labelIds ?? [];
      if (!labels.includes(draftOnly ? 'DRAFT' : 'SENT')) return false;
      const headers = message.data.payload?.headers ?? [];
      const toHeader = headers.find((header) => header.name?.toLowerCase() === 'to')?.value ?? '';
      if (!toHeader.toLowerCase().includes(options.to.trim().toLowerCase())) return false;
      return decodeBody(message.data.payload).includes(bodyContains);
    } catch (error) {
      throw asToolError(error, 'messages.get');
    }
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

interface Part { mimeType?: string | null; body?: { data?: string | null } | null; parts?: Part[] | null }

function decodeBody(part: Part | undefined | null): string {
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

import { google } from 'googleapis';
import { ToolError } from '@dira/tool-contracts';

export interface GmailSourceMessage {
  id: string;
  threadId: string;
  historyId?: string;
  from: string;
  to: string;
  subject: string;
  receivedAtIso: string;
  body: string;
}

export interface GmailSyncResult {
  messages: GmailSourceMessage[];
  accountEmail: string;
  nextHistoryId: string;
  reset: boolean;
}

/** Gmail read-only adapter used by the account intake path. Never sends or mutates mail. */
export class GoogleUserGmailTool {
  constructor(private readonly getAccessToken: () => Promise<string>) {}

  private async client() {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: await this.getAccessToken() });
    return google.gmail({ version: 'v1', auth });
  }

  async verifyMessage(messageId: string): Promise<boolean> {
    const api = await this.client();
    try {
      const result = await api.users.messages.get({ userId: 'me', id: messageId, format: 'minimal' });
      return Boolean(result.data.id);
    } catch (error) {
      if (httpStatus(error) === 404) return false;
      throw asToolError(error, 'verifyMessage');
    }
  }

  /** Incremental inbox poll. Initial sync is bounded to recent inbox messages. */
  async syncMessages(historyId?: string): Promise<GmailSyncResult> {
    const api = await this.client();
    let cursor = historyId;
    let reset = !historyId;
    for (;;) {
      try {
        const profile = await api.users.getProfile({ userId: 'me' });
        const baseline = profile.data.historyId;
        if (!baseline) throw new ToolError('Gmail profile returned no historyId', 'INVALID_RESPONSE', true);
        const ids = new Set<string>();
        if (!cursor) {
          // Capture the watermark before listing so arrivals during the initial
          // bounded scan are recovered by history.list below.
          cursor = baseline;
          const response = await api.users.messages.list({
            userId: 'me',
            q: 'in:inbox newer_than:7d -category:promotions -category:social',
            maxResults: 10,
          });
          for (const message of response.data.messages ?? []) if (message.id) ids.add(message.id);
        }

        let pageToken: string | undefined;
        let nextHistoryId = baseline;
        if (cursor) {
          do {
            const response = await api.users.history.list({
              userId: 'me',
              startHistoryId: cursor,
              historyTypes: ['messageAdded'],
              maxResults: 500,
              ...(pageToken ? { pageToken } : {}),
            });
            for (const item of response.data.history ?? []) {
              for (const added of item.messagesAdded ?? []) {
                if (added.message?.id) ids.add(added.message.id);
              }
            }
            nextHistoryId = response.data.historyId ?? nextHistoryId;
            pageToken = response.data.nextPageToken ?? undefined;
          } while (pageToken);
        }

        const messages: GmailSourceMessage[] = [];
        for (const id of ids) {
          const result = await api.users.messages.get({ userId: 'me', id, format: 'full' }).catch((error: unknown) => {
            if (httpStatus(error) === 404) return null;
            throw error;
          });
          if (!result) continue;
          const message = result.data;
          const labels = message.labelIds ?? [];
          if (!message.id || !message.threadId || !labels.includes('INBOX') || labels.includes('SENT')) continue;
          const headers = new Map((message.payload?.headers ?? []).map((header) => [
            (header.name ?? '').toLowerCase(), header.value ?? '',
          ]));
          const from = headers.get('from') ?? '';
          const to = headers.get('to') ?? '';
          const body = extractPlainText(message.payload).slice(0, 8_000);
          const internalDate = Number(message.internalDate);
          messages.push({
            id: message.id,
            threadId: message.threadId,
            historyId: message.historyId ?? undefined,
            from: from.slice(0, 320),
            to: to.slice(0, 320),
            subject: (headers.get('subject') ?? '(no subject)').slice(0, 500),
            receivedAtIso: Number.isFinite(internalDate) ? new Date(internalDate).toISOString() : new Date().toISOString(),
            body: (body || message.snippet || '').slice(0, 8_000),
          });
        }
        return { messages, accountEmail: profile.data.emailAddress ?? '', nextHistoryId, reset };
      } catch (error) {
        if (cursor && !reset && httpStatus(error) === 404) {
          cursor = undefined;
          reset = true;
          continue;
        }
        throw asToolError(error, 'syncMessages');
      }
    }
  }
}

type GmailPart = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPart[] | null;
};

function extractPlainText(payload: GmailPart | null | undefined): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  }
  for (const part of payload.parts ?? []) {
    const text = extractPlainText(part);
    if (text) return text;
  }
  return '';
}

function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { code?: number; status?: number; response?: { status?: number } };
  return value.response?.status ?? value.status ?? value.code;
}

function asToolError(error: unknown, operation: string): ToolError {
  if (error instanceof ToolError) return error;
  const value = error as { code?: number; message?: string };
  return new ToolError(value.message ?? `Google Gmail ${operation} failed`, `HTTP_${value.code ?? 'UNKNOWN'}`, true);
}

import { createHash } from 'node:crypto';
import type { calendar_v3 } from 'googleapis';
import { ToolError, type CalendarEvent, type CalendarTool } from '@dira/tool-contracts';

/** User Calendar adapter; mutations stay disabled unless the account has separately granted write scope. */
export class GoogleUserCalendarTool implements CalendarTool {
  constructor(
    private readonly accessToken: () => Promise<string>,
    private readonly canWrite: () => Promise<boolean> = async () => false,
  ) {}

  private async client(): Promise<calendar_v3.Calendar> {
    const { google } = await import('googleapis');
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: await this.accessToken() });
    return google.calendar({ version: 'v3', auth });
  }

  private toCalendarEvent(event: calendar_v3.Schema$Event): CalendarEvent {
    const googleEventId = event.id ?? '';
    return {
      id: event.extendedProperties?.private?.diraId ?? `google:${googleEventId}`,
      title: event.summary ?? '(untitled event)',
      startIso: event.start?.dateTime ?? event.start?.date ?? '',
      endIso: event.end?.dateTime ?? event.end?.date ?? '',
      metadata: { googleEventId, source: 'google-calendar' },
    };
  }

  async getEvents(): Promise<CalendarEvent[]> {
    try {
      const api = await this.client();
      const response = await api.events.list({
        calendarId: 'primary',
        timeMin: new Date().toISOString(),
        maxResults: 250,
        singleEvents: true,
        showDeleted: false,
        orderBy: 'startTime',
      });
      return (response.data.items ?? []).map((event) => this.toCalendarEvent(event));
    } catch (error) {
      throw asToolError(error, 'getEvents');
    }
  }

  async createEvent(event: CalendarEvent): Promise<{ id: string }> {
    await this.requireWriteAccess();
    try {
      const api = await this.client();
      const response = await api.events.insert({
        calendarId: 'primary',
        requestBody: {
          id: googleEventIdFor(event.id),
          summary: event.title,
          start: { dateTime: event.startIso },
          end: { dateTime: event.endIso },
          extendedProperties: { private: { diraId: event.id } },
        },
      });
      if (!response.data.id) throw new ToolError('Google Calendar did not return a created event id', 'INVALID_RESPONSE', false);
      return { id: response.data.id };
    } catch (error) {
      throw asToolError(error, 'createEvent');
    }
  }

  async moveEvent(id: string, startIso: string, endIso: string): Promise<void> {
    await this.requireWriteAccess();
    try {
      const api = await this.client();
      const existing = await this.findEvent(api, id);
      if (!existing?.id) throw new ToolError(`Google Calendar event ${id} was not found`, 'NOT_FOUND', false);
      await api.events.patch({
        calendarId: 'primary',
        eventId: existing.id,
        requestBody: {
          start: { dateTime: startIso },
          end: { dateTime: endIso },
        },
      });
    } catch (error) {
      throw asToolError(error, 'moveEvent');
    }
  }

  async deleteEvent(id: string): Promise<void> {
    await this.requireWriteAccess();
    try {
      const api = await this.client();
      const existing = await this.findEvent(api, id);
      if (!existing?.id) return;
      await api.events.delete({ calendarId: 'primary', eventId: existing.id });
    } catch (error) {
      throw asToolError(error, 'deleteEvent');
    }
  }

  async verifyEvent(query: { id?: string; title?: string; startIso?: string }): Promise<CalendarEvent | null> {
    try {
      const api = await this.client();
      const found = query.id ? await this.findEvent(api, query.id) : undefined;
      if (!found) return null;
      const event = this.toCalendarEvent(found);
      if (query.title && event.title !== query.title) return null;
      if (query.startIso && Date.parse(event.startIso) !== Date.parse(query.startIso)) return null;
      return event;
    } catch (error) {
      throw asToolError(error, 'verifyEvent');
    }
  }

  private async requireWriteAccess(): Promise<void> {
    if (!await this.canWrite()) {
      throw new ToolError('Google Calendar write permission has not been granted for this account', 'INSUFFICIENT_SCOPE', false);
    }
  }

  private async findEvent(api: calendar_v3.Calendar, id: string): Promise<calendar_v3.Schema$Event | undefined> {
    if (id.startsWith('google:')) {
      const response = await api.events.get({ calendarId: 'primary', eventId: id.slice('google:'.length) });
      return response.data;
    }
    const response = await api.events.list({
      calendarId: 'primary',
      privateExtendedProperty: [`diraId=${id}`],
      maxResults: 1,
      singleEvents: true,
    });
    return response.data.items?.[0];
  }
}

function googleEventIdFor(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 40);
}

function asToolError(error: unknown, operation: string): ToolError {
  if (error instanceof ToolError) return error;
  const value = error as { code?: number; message?: string };
  const status = typeof value.code === 'number' ? value.code : 0;
  throw new ToolError(
    `Google Calendar ${operation} failed: ${value.message ?? String(error)}`,
    `HTTP_${status || 'ERR'}`,
    status >= 500 || status === 429,
  );
}

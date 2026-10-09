import type { calendar_v3 } from 'googleapis';
import { ToolError, type CalendarEvent, type CalendarTool } from '@dira/tool-contracts';

/** Read-only adapter for the signed-in account's primary Google Calendar. */
export class GoogleUserCalendarTool implements CalendarTool {
  constructor(private readonly accessToken: () => Promise<string>) {}

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

  async createEvent(_event: CalendarEvent): Promise<{ id: string }> {
    throw new ToolError('Google Calendar is connected read-only; grant write access to change events', 'INSUFFICIENT_SCOPE', false);
  }

  async moveEvent(_id: string, _startIso: string, _endIso: string): Promise<void> {
    throw new ToolError('Google Calendar is connected read-only; grant write access to change events', 'INSUFFICIENT_SCOPE', false);
  }

  async deleteEvent(_id: string): Promise<void> {
    throw new ToolError('Google Calendar is connected read-only; grant write access to change events', 'INSUFFICIENT_SCOPE', false);
  }

  async verifyEvent(query: { id?: string; title?: string; startIso?: string }): Promise<CalendarEvent | null> {
    try {
      const api = await this.client();
      let found: calendar_v3.Schema$Event | undefined;
      if (query.id?.startsWith('google:')) {
        const googleId = query.id.slice('google:'.length);
        const response = await api.events.get({ calendarId: 'primary', eventId: googleId });
        found = response.data;
      } else if (query.id) {
        const response = await api.events.list({
          calendarId: 'primary',
          privateExtendedProperty: [`diraId=${query.id}`],
          maxResults: 1,
          singleEvents: true,
        });
        found = response.data.items?.[0];
      }
      if (!found) return null;
      const event = this.toCalendarEvent(found);
      if (query.title && event.title !== query.title) return null;
      if (query.startIso && Date.parse(event.startIso) !== Date.parse(query.startIso)) return null;
      return event;
    } catch (error) {
      throw asToolError(error, 'verifyEvent');
    }
  }
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

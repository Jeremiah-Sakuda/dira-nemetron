import { commitmentStakeholders, minutesToIso, minutesToLabel, type DomainState } from '@dira/commitment-model';
import { GoogleUserCalendarTool } from '@dira/adapter-calendar/user-google';
import { GoogleUserMailTool, deterministicMessageId, withDisclosure, type OutboundMailGuard } from '@dira/adapter-gmail/user-google-mail';
import {
  ToolError,
  type CalendarEvent,
  type CalendarTool,
  type GmailMessage,
  type GmailTool,
  type OrgTask,
  type OrgTaskTool,
  type OutboundMessageOptions,
  type OutboundVerifyOptions,
  type RecruiterBooking,
  type RecruiterSlot,
  type RecruiterTool,
  type ToolSet,
} from '@dira/tool-contracts';
import type { PostgresAccountStore } from './postgres-store.js';
import { assertReviewedCalendarOccupancy } from './calendar-occupancy.js';

/**
 * Per-account execution tools for the event-driven repair engine.
 *
 *  - Google accounts: the user's Google Calendar and Gmail (drafts or send,
 *    per the draft-only policy), plus Dira's own delegation and booking
 *    records.
 *  - Demo accounts: Postgres-backed simulators for a calendar, a mailbox and
 *    a counterparty's slot list, isolated per demo session by RLS. They are
 *    labeled "simulated" everywhere they surface; they are never presented as
 *    Google services.
 */

export type AccountKind = 'google' | 'demo';

export interface AccountToolLabels {
  calendar: string;
  mail: string;
  delegation: string;
  booking: string;
  simulated: boolean;
}

export interface AccountToolContext {
  store: PostgresAccountStore;
  accountId: string;
  kind: AccountKind;
  /** Current world model, read at call time. */
  state: () => DomainState;
  draftOnly: () => Promise<boolean>;
  ownerEmail: string;
  google?: {
    accessToken: () => Promise<string>;
    scopes: () => Promise<readonly string[]>;
    calendarFenced: () => Promise<boolean>;
  };
}

export const DEMO_EMAIL_DOMAINS = ['.demo'];

export function accountToolLabels(kind: AccountKind): AccountToolLabels {
  return kind === 'demo'
    ? {
      calendar: 'Simulated calendar (demo session)',
      mail: 'Simulated mailbox (demo session)',
      delegation: 'Dira delegation record',
      booking: 'Simulated counterparty slots (demo session)',
      simulated: true,
    }
    : {
      calendar: 'Google Calendar',
      mail: 'Gmail',
      delegation: 'Dira delegation record',
      booking: 'Reply to the counterparty in Gmail',
      simulated: false,
    };
}

export function buildAccountToolSet(context: AccountToolContext): ToolSet {
  const guard = mailGuard(context);
  const gmail: GmailTool = context.kind === 'demo'
    ? new SimulatedMailTool(context.store, context.accountId, guard)
    : new GoogleUserMailTool(context.google!.accessToken, guard, context.google!.scopes);
  const calendar: CalendarTool = context.kind === 'demo'
    ? new SimulatedCalendarTool(context.store, context.accountId)
    : new GoogleIdCalendarTool(new GoogleUserCalendarTool(
      context.google!.accessToken,
      async () => (await context.google!.scopes()).includes('https://www.googleapis.com/auth/calendar.events'),
      context.google!.calendarFenced,
    ), context.state);
  return {
    calendar,
    gmail,
    org: new DelegationRecordTool(context.store, context.accountId, context.state),
    recruiter: new AccountBookingTool(context, gmail),
  };
}

function mailGuard(context: AccountToolContext): OutboundMailGuard {
  return {
    async allowedRecipients() {
      const state = context.state();
      const emails = new Set<string>();
      for (const id of Object.keys(state.commitments)) {
        for (const personId of commitmentStakeholders(state, id)) {
          const email = state.people[personId]?.email.trim().toLowerCase();
          if (!email) continue;
          if (context.kind === 'demo' && !DEMO_EMAIL_DOMAINS.some((domain) => email.endsWith(domain))) continue;
          emails.add(email);
        }
      }
      return emails;
    },
    draftOnly: context.draftOnly,
    async ownerName() {
      const state = context.state();
      return state.people[state.userId]?.name ?? context.ownerEmail;
    },
    async ownerEmail() {
      return context.ownerEmail;
    },
  };
}

/** Google ids are stored bare on commitments; the user adapter addresses them as google:<id>. */
class GoogleIdCalendarTool implements CalendarTool {
  constructor(private readonly inner: GoogleUserCalendarTool, private readonly state: () => DomainState) {}
  private id(value: string): string {
    return value.startsWith('google:') || value.startsWith('cal-') ? value : `google:${value}`;
  }
  getEvents() { return this.inner.getEvents(); }
  async createEvent(event: CalendarEvent) { await assertReviewedCalendarOccupancy(this.inner, this.state(), [event.id]); return this.inner.createEvent(event); }
  async moveEvent(id: string, startIso: string, endIso: string) { await assertReviewedCalendarOccupancy(this.inner, this.state()); return this.inner.moveEvent(this.id(id), startIso, endIso); }
  async deleteEvent(id: string) { await assertReviewedCalendarOccupancy(this.inner, this.state()); return this.inner.deleteEvent(this.id(id)); }
  async verifyEvent(query: { id?: string; title?: string; startIso?: string }) {
    const event = await this.inner.verifyEvent({ ...query, ...(query.id ? { id: this.id(query.id) } : {}) });
    if (!event) return null;
    const googleId = event.metadata?.googleEventId;
    return googleId ? { ...event, metadata: { ...event.metadata, externalId: googleId } } : event;
  }
}

export class SimulatedCalendarTool implements CalendarTool {
  constructor(private readonly store: PostgresAccountStore, private readonly accountId: string) {}

  private key(id: string): string {
    return id.startsWith('google:') ? id.slice('google:'.length) : id;
  }

  async getEvents(): Promise<CalendarEvent[]> {
    return this.store.withAccount(this.accountId, async (client) => {
      const result = await client.query<{ event_id: string; title: string; start_iso: string; end_iso: string; tentative: boolean }>(
        'SELECT event_id, title, start_iso, end_iso, tentative FROM dira_sim_calendar_events WHERE account_id = $1 ORDER BY start_iso',
        [this.accountId],
      );
      return result.rows.map(toCalendarEvent);
    });
  }

  async createEvent(event: CalendarEvent): Promise<{ id: string }> {
    await this.store.withAccount(this.accountId, async (client) => {
      await client.query(
        `INSERT INTO dira_sim_calendar_events (account_id, event_id, title, start_iso, end_iso)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (account_id, event_id) DO UPDATE SET title = EXCLUDED.title,
           start_iso = EXCLUDED.start_iso, end_iso = EXCLUDED.end_iso, updated_at = now()`,
        [this.accountId, this.key(event.id), event.title, event.startIso, event.endIso],
      );
    });
    return { id: this.key(event.id) };
  }

  async moveEvent(id: string, startIso: string, endIso: string): Promise<void> {
    const updated = await this.store.withAccount(this.accountId, async (client) => {
      const result = await client.query(
        'UPDATE dira_sim_calendar_events SET start_iso = $3, end_iso = $4, updated_at = now() WHERE account_id = $1 AND event_id = $2',
        [this.accountId, this.key(id), startIso, endIso],
      );
      return result.rowCount ?? 0;
    });
    if (!updated) throw new ToolError(`simulated calendar event ${id} not found`, 'NOT_FOUND', false);
  }

  async deleteEvent(id: string): Promise<void> {
    await this.store.withAccount(this.accountId, async (client) => {
      await client.query('DELETE FROM dira_sim_calendar_events WHERE account_id = $1 AND event_id = $2', [this.accountId, this.key(id)]);
    });
  }

  async verifyEvent(query: { id?: string; title?: string; startIso?: string }): Promise<CalendarEvent | null> {
    if (!query.id) return null;
    return this.store.withAccount(this.accountId, async (client) => {
      const result = await client.query<{ event_id: string; title: string; start_iso: string; end_iso: string; tentative: boolean }>(
        'SELECT event_id, title, start_iso, end_iso, tentative FROM dira_sim_calendar_events WHERE account_id = $1 AND event_id = $2',
        [this.accountId, this.key(query.id!)],
      );
      const row = result.rows[0];
      if (!row) return null;
      const event = toCalendarEvent(row);
      if (query.title && event.title !== query.title) return null;
      if (query.startIso && Date.parse(event.startIso) !== Date.parse(query.startIso)) return null;
      return event;
    });
  }
}

function toCalendarEvent(row: { event_id: string; title: string; start_iso: string; end_iso: string; tentative: boolean }): CalendarEvent {
  return {
    id: row.event_id,
    title: row.title,
    startIso: row.start_iso,
    endIso: row.end_iso,
    metadata: { source: 'simulated-calendar', externalId: row.event_id, ...(row.tentative ? { tentative: 'true' } : {}) },
  };
}

export class SimulatedMailTool implements GmailTool {
  constructor(
    private readonly store: PostgresAccountStore,
    private readonly accountId: string,
    private readonly guard: OutboundMailGuard,
  ) {}

  async readMessage(messageId: string): Promise<GmailMessage | null> {
    return this.store.withAccount(this.accountId, async (client) => {
      const result = await client.query<SimMessageRow>(
        'SELECT * FROM dira_sim_messages WHERE account_id = $1 AND message_id = $2', [this.accountId, messageId]);
      return result.rows[0] ? toGmailMessage(result.rows[0]) : null;
    });
  }

  async readThread(threadId: string): Promise<GmailMessage[]> {
    return this.store.withAccount(this.accountId, async (client) => {
      const result = await client.query<SimMessageRow>(
        'SELECT * FROM dira_sim_messages WHERE account_id = $1 AND thread_id = $2 ORDER BY created_at', [this.accountId, threadId]);
      return result.rows.map(toGmailMessage);
    });
  }

  async sendReply(threadId: string, to: string, body: string, options: OutboundMessageOptions = {}): Promise<{ messageId: string; mode: 'sent' | 'draft' }> {
    const recipient = to.trim().toLowerCase();
    if (!(await this.guard.allowedRecipients()).has(recipient)) {
      throw new ToolError(`recipient ${recipient} is not a demo stakeholder`, 'RECIPIENT_NOT_ALLOWED', false);
    }
    const draftOnly = await this.guard.draftOnly();
    const messageId = deterministicMessageId(threadId, recipient, body);
    const from = await this.guard.ownerEmail();
    const disclosed = withDisclosure(body, await this.guard.ownerName());
    await this.store.withAccount(this.accountId, async (client) => {
      await client.query(
        `INSERT INTO dira_sim_messages (account_id, message_id, thread_id, folder, from_address, to_address, subject, body)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (account_id, message_id) DO NOTHING`,
        [this.accountId, messageId, threadId, draftOnly ? 'DRAFTS' : 'SENT', from, recipient,
          options.subject ?? 'Update from Dira', disclosed],
      );
    });
    return { messageId, mode: draftOnly ? 'draft' : 'sent' };
  }

  async verifyReply(threadId: string, bodyContains: string, options: OutboundVerifyOptions = {}): Promise<boolean> {
    if (!options.to || !options.body) return false;
    const messageId = deterministicMessageId(threadId, options.to.trim().toLowerCase(), options.body);
    const folder = (await this.guard.draftOnly()) ? 'DRAFTS' : 'SENT';
    return this.store.withAccount(this.accountId, async (client) => {
      const result = await client.query<SimMessageRow>(
        'SELECT * FROM dira_sim_messages WHERE account_id = $1 AND message_id = $2', [this.accountId, messageId]);
      const row = result.rows[0];
      return Boolean(row && row.folder === folder && row.to_address === options.to!.trim().toLowerCase()
        && row.thread_id === threadId && row.body.includes(bodyContains));
    });
  }
}

interface SimMessageRow {
  message_id: string; thread_id: string; folder: string; from_address: string; to_address: string; subject: string; body: string;
}

function toGmailMessage(row: SimMessageRow): GmailMessage {
  return { messageId: row.message_id, threadId: row.thread_id, from: row.from_address, to: row.to_address, subject: row.subject, body: row.body };
}

/** Dira's own record of who owns a task. Internal state; the notification is the external effect. */
export class DelegationRecordTool implements OrgTaskTool {
  constructor(
    private readonly store: PostgresAccountStore,
    private readonly accountId: string,
    private readonly state: () => DomainState,
  ) {}

  async getTask(id: string): Promise<OrgTask | null> {
    const row = await this.row(id);
    if (row) return row;
    const commitment = Object.values(this.state().commitments).find((item) => item.id === id || item.externalId === id);
    if (!commitment) return null;
    return { id, title: commitment.title, owner: commitment.owner, dueIso: '', status: 'OPEN' };
  }

  async updateOwner(id: string, owner: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task) throw new ToolError(`task ${id} not found`, 'NOT_FOUND', false);
    if (!this.state().people[owner]) throw new ToolError(`owner ${owner} is not a stored person`, 'INVALID_OWNER', false);
    await this.store.withAccount(this.accountId, async (client) => {
      await client.query(
        `INSERT INTO dira_delegations (account_id, task_id, title, owner, due_iso) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (account_id, task_id) DO UPDATE SET owner = EXCLUDED.owner, updated_at = now()`,
        [this.accountId, id, task.title, owner, task.dueIso || null],
      );
    });
  }

  async verifyAssignment(id: string): Promise<{ owner: string } | null> {
    const row = await this.row(id);
    return row ? { owner: row.owner } : null;
  }

  private async row(id: string): Promise<OrgTask | null> {
    return this.store.withAccount(this.accountId, async (client) => {
      const result = await client.query<{ task_id: string; title: string; owner: string; due_iso: string | null }>(
        'SELECT task_id, title, owner, due_iso FROM dira_delegations WHERE account_id = $1 AND task_id = $2',
        [this.accountId, id],
      );
      const row = result.rows[0];
      return row ? { id: row.task_id, title: row.title, owner: row.owner, dueIso: row.due_iso ?? '', status: 'OPEN' } : null;
    });
  }
}

/**
 * BOOK_INTERVIEW_SLOT for personal accounts: accept one of the counterparty's
 * offered times by replying in their thread, then record the booking as
 * AWAITING_COUNTERPARTY. Verification re-reads the reply from the mailbox.
 */
export class AccountBookingTool implements RecruiterTool {
  constructor(private readonly context: AccountToolContext, private readonly mail: GmailTool) {}

  async getAvailableSlots(interviewId: string): Promise<RecruiterSlot[]> {
    if (this.context.kind === 'demo') {
      return this.context.store.withAccount(this.context.accountId, async (client) => {
        const result = await client.query<{ slot_id: string; start_iso: string; end_iso: string }>(
          `SELECT slot_id, start_iso, end_iso FROM dira_sim_slots
           WHERE account_id = $1 AND commitment_id = $2 AND booked = false ORDER BY start_iso`,
          [this.context.accountId, interviewId],
        );
        return result.rows.map((row) => ({ slotId: row.slot_id, startIso: row.start_iso, endIso: row.end_iso }));
      });
    }
    // An emailed offer cannot be checked live; the counterparty confirms after the reply.
    const state = this.context.state();
    return (state.approvedSlots[interviewId] ?? []).map((slot) => ({
      slotId: `offered-${interviewId}-${slot.startMin}`,
      startIso: minutesToIso(slot.startMin, state.horizonStartIso, state.timezone),
      endIso: minutesToIso(slot.startMin + slot.durationMin, state.horizonStartIso, state.timezone),
    }));
  }

  async bookSlot(interviewId: string, slotId: string, idempotencyKey: string): Promise<RecruiterBooking> {
    const slot = (await this.getAvailableSlots(interviewId)).find((item) => item.slotId === slotId);
    if (!slot) throw new ToolError('SLOT_NO_LONGER_AVAILABLE', 'SLOT_NO_LONGER_AVAILABLE', false);
    if (this.context.kind === 'demo') {
      const available = await this.context.store.withAccount(this.context.accountId, async (client) => {
        const result = await client.query<{ actually_available: boolean }>(
          'SELECT actually_available FROM dira_sim_slots WHERE account_id = $1 AND commitment_id = $2 AND slot_id = $3 FOR UPDATE',
          [this.context.accountId, interviewId, slotId],
        );
        await client.query(
          'UPDATE dira_sim_slots SET booked = true WHERE account_id = $1 AND commitment_id = $2 AND slot_id = $3',
          [this.context.accountId, interviewId, slotId],
        );
        return result.rows[0]?.actually_available === true;
      });
      if (!available) {
        throw new ToolError('409 SLOT_NO_LONGER_AVAILABLE: the counterparty already gave this time away', 'SLOT_NO_LONGER_AVAILABLE', false);
      }
    }
    const message = this.acceptance(interviewId, slot.startIso);
    await this.mail.sendReply(message.threadId, message.to, message.body, { subject: message.subject });
    const bookingId = `booking-${idempotencyKey.slice(-24).replace(/[^a-z0-9-]/gi, '')}`;
    await this.context.store.withAccount(this.context.accountId, async (client) => {
      await client.query(
        `INSERT INTO dira_bookings (account_id, commitment_id, booking_id, slot_id, start_iso, message_ref, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'AWAITING_COUNTERPARTY')
         ON CONFLICT (account_id, commitment_id) DO UPDATE SET booking_id = EXCLUDED.booking_id,
           slot_id = EXCLUDED.slot_id, start_iso = EXCLUDED.start_iso, message_ref = EXCLUDED.message_ref,
           status = 'AWAITING_COUNTERPARTY', updated_at = now()`,
        [this.context.accountId, interviewId, bookingId, slotId, slot.startIso, JSON.stringify(message)],
      );
    });
    return { bookingId, slotId, startIso: slot.startIso };
  }

  async verifyBooking(interviewId: string): Promise<RecruiterBooking | null> {
    const row = await this.context.store.withAccount(this.context.accountId, async (client) => {
      const result = await client.query<{ booking_id: string; slot_id: string; start_iso: string; message_ref: string }>(
        'SELECT booking_id, slot_id, start_iso, message_ref FROM dira_bookings WHERE account_id = $1 AND commitment_id = $2',
        [this.context.accountId, interviewId],
      );
      return result.rows[0];
    });
    if (!row) return null;
    const message = JSON.parse(row.message_ref) as { threadId: string; to: string; body: string };
    const delivered = await this.mail.verifyReply(message.threadId, 'Dira', { to: message.to, body: message.body });
    return delivered ? { bookingId: row.booking_id, slotId: row.slot_id, startIso: row.start_iso } : null;
  }

  private acceptance(interviewId: string, startIso: string) {
    const state = this.context.state();
    const commitment = state.commitments[interviewId];
    if (!commitment) throw new ToolError(`unknown commitment ${interviewId}`, 'NOT_FOUND', false);
    const counterpartyId = commitmentStakeholders(state, interviewId)[0];
    const counterparty = counterpartyId ? state.people[counterpartyId] : undefined;
    if (!counterparty) throw new ToolError(`no stored counterparty for ${commitment.title}`, 'NO_COUNTERPARTY', false);
    const offer = (state.approvedSlots[interviewId] ?? [])[0];
    const user = state.people[state.userId]?.name ?? this.context.ownerEmail;
    const when = minutesToLabel(
      Math.round((Date.parse(startIso) - Date.parse(state.horizonStartIso)) / 60_000),
      state.horizonStartIso, state.timezone,
    );
    return {
      threadId: offer?.provenance ?? `thread-dira-${interviewId}`,
      to: counterparty.email.toLowerCase(),
      subject: `Re: ${commitment.title}`,
      body: `Hi ${counterparty.name.split(/\s+/)[0]}, this is Dira, an assistant writing on behalf of ${user}. `
        + `${user} would like to take the ${when} time you offered for "${commitment.title}". `
        + 'Please reply to confirm; until then the time is held as tentative.',
    };
  }
}

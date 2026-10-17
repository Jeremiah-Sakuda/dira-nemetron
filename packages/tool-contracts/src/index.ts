/**
 * Narrow tool adapters (PRD §30). The agent never receives unrestricted
 * credentials — every integration is an adapter exposing only the operations
 * Dira is allowed to perform, and every mutating tool exposes an independent
 * verification read.
 */

export interface CalendarEvent {
  id: string;
  title: string;
  startIso: string;
  endIso: string;
  metadata?: Record<string, string>;
}

export class ToolError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly transient: boolean,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export interface CalendarTool {
  getEvents(): Promise<CalendarEvent[]>;
  createEvent(event: CalendarEvent): Promise<{ id: string }>;
  moveEvent(id: string, startIso: string, endIso: string): Promise<void>;
  deleteEvent(id: string): Promise<void>;
  /** Independent read: does an event exist matching this desired state? */
  verifyEvent(query: { id?: string; title?: string; startIso?: string }): Promise<CalendarEvent | null>;
}

export interface GmailMessage {
  threadId: string;
  messageId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
}

export interface OutboundMessageOptions {
  subject?: string;
}

export interface OutboundVerifyOptions {
  /** Exact recipient and body let adapters derive a deterministic message identity. */
  to?: string;
  body?: string;
  subject?: string;
  /** Durable provider receipt: a fresh GET still checks every expected field. */
  messageId?: string;
}

export interface GmailTool {
  readMessage(messageId: string): Promise<GmailMessage | null>;
  readThread(threadId: string): Promise<GmailMessage[]>;
  sendReply(threadId: string, to: string, body: string, options?: OutboundMessageOptions): Promise<{ messageId: string; mode?: 'sent' | 'draft' }>;
  verifyReply(threadId: string, bodyContains: string, options?: OutboundVerifyOptions): Promise<boolean>;
}

export interface OrgTask {
  id: string;
  title: string;
  owner: string;
  dueIso: string;
  status: 'OPEN' | 'DONE';
}

export interface OrgTaskTool {
  getTask(id: string): Promise<OrgTask | null>;
  updateOwner(id: string, owner: string): Promise<void>;
  verifyAssignment(id: string): Promise<{ owner: string } | null>;
}

export interface RecruiterSlot {
  slotId: string;
  startIso: string;
  endIso: string;
}

export interface RecruiterBooking {
  bookingId: string;
  slotId: string;
  startIso: string;
}

export interface RecruiterTool {
  getAvailableSlots(interviewId: string): Promise<RecruiterSlot[]>;
  /** Throws ToolError code=SLOT_NO_LONGER_AVAILABLE (409) when the slot is gone. */
  bookSlot(interviewId: string, slotId: string, idempotencyKey: string): Promise<RecruiterBooking>;
  verifyBooking(interviewId: string): Promise<RecruiterBooking | null>;
}

export interface ToolSet {
  calendar: CalendarTool;
  gmail: GmailTool;
  org: OrgTaskTool;
  recruiter: RecruiterTool;
}

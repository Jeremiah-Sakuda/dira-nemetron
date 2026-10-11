import { DEFAULT_ENGINE_CONFIG, minutesToIso, type DomainState } from '@dira/commitment-model';
import type { InterpretationResult, RawEmailEvent } from '@dira/event-schema';
import type { CalendarEvent, GmailMessage, OrgTask } from '@dira/tool-contracts';
import type { SlotState } from '../types.js';

/**
 * Repair scenarios outside the four shapes the deterministic enumerator knows
 * (rebook an offered slot, delegate to a stored backup, reclaim flexible
 * capacity, rebuild the study plan). They exist to measure whether Nemotron
 * Ultra adds valid candidates, not to script its answer. All identities are
 * synthetic.
 */

export interface RepairScenarioFixture {
  name: string;
  description: string;
  state: DomainState;
  calendarSeed: CalendarEvent[];
  orgSeed: OrgTask[];
  recruiterSlots: { interviewId: string; slots: SlotState[] };
  inboxSeed: GmailMessage[];
  trigger: RawEmailEvent;
  interpretation: InterpretationResult;
}

/** A TA moves a fixed review session onto a flexible reading block. */
export function buildOverlapScenario(): RepairScenarioFixture {
  const horizonStartIso = '2026-10-12T00:00:00-04:00';
  const now = horizonStartIso;
  const user = 'user-ada';
  const base = {
    userId: user, participants: [user], goalIds: [], resourceRequirements: ['user-time'],
    confidence: 1, createdAtIso: now, updatedAtIso: now, status: 'PLANNED' as const, owner: user,
  };
  const state: DomainState = {
    userId: user,
    timezone: 'America/New_York',
    horizonStartIso,
    horizonEndMin: 3 * 1440,
    commitments: {
      'review-session': { ...base, id: 'review-session', title: 'Lab review session', domain: 'academic', source: 'calendar',
        kind: 'event', startMin: 10 * 60, durationMin: 60, flexibility: 'FIXED', criticality: 'HIGH',
        externalSystem: 'calendar', externalId: 'cal-review-session' },
      'reading-block': { ...base, id: 'reading-block', title: 'Reading block', domain: 'personal', source: 'calendar',
        kind: 'block', startMin: 14 * 60, durationMin: 90, flexibility: 'FLEXIBLE', criticality: 'LOW',
        externalSystem: 'calendar', externalId: 'cal-reading-block' },
    },
    edges: [{ id: 'edge-review-owner', type: 'OWNED_BY', from: 'review-session', to: 'ta-lin',
      data: { provenance: 'user-confirmed during graph review' } }],
    people: {
      [user]: { id: user, name: 'Ada Park', email: 'ada.park@student.demo' },
      'ta-lin': { id: 'ta-lin', name: 'Lin Wu', email: 'lin.wu@university.demo', authorityDomains: ['academic'] },
    },
    constraints: {},
    availability: [],
    approvedSlots: {},
    config: { ...DEFAULT_ENGINE_CONFIG },
  };
  const at = (minute: number) => minutesToIso(minute, horizonStartIso);
  const trigger: RawEmailEvent = {
    eventId: 'evt-review-move', source: 'gmail', threadId: 'thread-review', messageId: 'msg-review-move',
    from: 'lin.wu@university.demo', to: 'ada.park@student.demo', subject: 'Review session moved',
    body: 'Hi all, the lab review session moves to 2:30 PM today because the room is booked in the morning. — Lin',
    receivedAtIso: at(8 * 60),
  };
  const interpretation: InterpretationResult = {
    relevant: true,
    reason: 'TA moved the review session',
    mutation: {
      entity_type: 'commitment', entity_id: 'review-session', mutation_type: 'schedule_change',
      old_start: at(600), new_start: at(14 * 60 + 30), unchanged_constraints: [], confidence: 0.97,
      evidence_quote: 'the lab review session moves to 2:30 PM today',
    },
  };
  return {
    name: 'overlap-flexible-block',
    description: 'A fixed session moves onto a flexible block; no enumerated repair shape covers an overlap.',
    state,
    calendarSeed: [
      { id: 'cal-review-session', title: 'Lab review session', startIso: at(600), endIso: at(660) },
      { id: 'cal-reading-block', title: 'Reading block', startIso: at(840), endIso: at(930) },
    ],
    orgSeed: [],
    recruiterSlots: { interviewId: 'none', slots: [] },
    inboxSeed: [{ threadId: trigger.threadId, messageId: trigger.messageId, from: trigger.from, to: trigger.to, subject: trigger.subject, body: trigger.body }],
    trigger,
    interpretation,
  };
}

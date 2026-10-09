import {
  DEFAULT_ENGINE_CONFIG,
  minutesToIso,
  type ApprovedSlot,
  type Commitment,
  type DomainState,
} from '@dira/commitment-model';
import type { InterpretationResult, RawEmailEvent } from '@dira/event-schema';
import type { CalendarEvent, GmailMessage, OrgTask } from '@dira/tool-contracts';
import type { SlotState } from '../types.js';

/**
 * The 48-Hour Shock — golden workflow fixture (PRD §5–§7).
 *
 * All synthetic identities (PRD §45): the student is Sam Adeyemi; Professor
 * Elena Chen teaches ECON 402; Jordan Lee recruits for a fictional TechCorp;
 * Maya Okafor is the student-org teammate and backup owner for visual QA.
 *
 * Numbers are engineered so the deterministic solver — not a script —
 * produces the PRD trajectory for the default variation:
 *   initial Global Slack  +246 min (+4.1h)
 *   after mutation        −216 min (−3.6h)
 *   after repair           +78 min (+1.3h)
 * See docs/algorithms/global-slack.md for the full derivation.
 */

export const HORIZON_START_ISO = '2026-08-18T00:00:00-05:00'; // Tue Aug 18
export const HORIZON_END_MIN = 4 * 1440; // Sat 00:00

/** Minutes from horizon start. day 0 = Tue, 1 = Wed, 2 = Thu, 3 = Fri. */
export const at = (day: number, hour: number, minute = 0): number =>
  day * 1440 + hour * 60 + minute;

export const iso = (min: number): string => minutesToIso(min, HORIZON_START_ISO);

export const USER_ID = 'user-sam';
export const IDS = {
  exam: 'econ402-midterm-2',
  prep: 'econ402-midterm-2-prep',
  ps6: 'problem-set-6',
  interview: 'technical-interview-1',
  presentation: 'sponsor-presentation',
  deckFreeze: 'sponsor-deck-freeze',
  assetsArrival: 'sponsor-assets-arrival',
  qa: 'sponsor-visual-qa',
  workout: 'tuesday-workout',
  sideProject: 'side-project-block',
} as const;

export const PEOPLE = {
  user: { id: USER_ID, name: 'Sam Adeyemi', email: 'sam.adeyemi@dira.demo' },
  maya: { id: 'maya-okafor', name: 'Maya Okafor', email: 'maya.okafor@university.demo' },
  tunde: { id: 'tunde-adebayo', name: 'Tunde Adebayo', email: 'tunde.adebayo@university.demo' },
  professor: { id: 'elena-chen', name: 'Prof. Elena Chen', email: 'elena.chen@university.demo' },
  recruiter: { id: 'jordan-lee', name: 'Jordan Lee', email: 'jordan.lee@techcorp.demo' },
} as const;

export const SLOT_PROVENANCE = 'gmail-thread-jordan-alt-slots';

/** PRD §7 — controlled runtime variation. Defaults reproduce the PRD numbers. */
export interface GoldenVariation {
  /** Wed exam start hour: 13, 14 (default) or 15. */
  examHour?: 13 | 14 | 15;
  /** The injected failure: Thu 10:00 is listed but actually taken (default true). */
  firstSlotTaken?: boolean;
  /** Chaos: both recruiter slots gone → Dira must stop safely. */
  bothSlotsTaken?: boolean;
  /** Duration of the flexible personal block in minutes (default 240). */
  personalBlockDurationMin?: number;
  /** Backup owner for visual QA (default maya-okafor). */
  backupOwner?: 'maya-okafor' | 'tunde-adebayo';
  /** Prep minutes already completed before the trigger (default 120 of 480). */
  prepCompletedMin?: number;
  /** Tue workout start hour (default 19.5 = 19:30) — a pre-trigger calendar shift. */
  workoutStartHour?: number;
}

export interface GoldenFixture {
  state: DomainState;
  calendarSeed: CalendarEvent[];
  orgSeed: OrgTask[];
  recruiterSlots: { interviewId: string; slots: SlotState[] };
  inboxSeed: GmailMessage[];
  trigger: RawEmailEvent;
  /** Stored semantic interpretation for REPLAY_MODE=deterministic (PRD §39). */
  interpretation: InterpretationResult;
  variation: Required<GoldenVariation>;
}

const cal = (id: string, title: string, start: number, end: number): CalendarEvent => ({
  id: `cal-${id}`,
  title,
  startIso: iso(start),
  endIso: iso(end),
});

export function buildGoldenFixture(variation: GoldenVariation = {}): GoldenFixture {
  const v: Required<GoldenVariation> = {
    examHour: variation.examHour ?? 14,
    firstSlotTaken: variation.firstSlotTaken ?? true,
    bothSlotsTaken: variation.bothSlotsTaken ?? false,
    personalBlockDurationMin: variation.personalBlockDurationMin ?? 240,
    backupOwner: variation.backupOwner ?? 'maya-okafor',
    prepCompletedMin: variation.prepCompletedMin ?? 120,
    workoutStartHour: variation.workoutStartHour ?? 19.5,
  };

  const now = iso(at(0, 8, 30)); // trigger arrives Tue 08:30
  const workoutStart = at(0, Math.floor(v.workoutStartHour), (v.workoutStartHour % 1) * 60);

  const base = {
    userId: USER_ID,
    participants: [USER_ID],
    goalIds: [] as string[],
    resourceRequirements: ['user-time'],
    confidence: 1,
    createdAtIso: now,
    updatedAtIso: now,
    status: 'PLANNED' as const,
  };

  const commitments: Commitment[] = [
    {
      ...base,
      id: IDS.exam,
      title: 'ECON 402 Midterm 2',
      domain: 'academic',
      source: 'syllabus',
      sourceReference: 'econ402-syllabus-v2',
      kind: 'event',
      startMin: at(3, 14), // Friday 2:00 PM
      durationMin: 60,
      flexibility: 'FIXED',
      criticality: 'CRITICAL',
      owner: USER_ID,
      externalSystem: 'calendar',
      externalId: `cal-${IDS.exam}`,
      goalIds: ['goal-econ-grade'],
    },
    {
      ...base,
      id: IDS.prep,
      title: 'ECON 402 exam preparation',
      domain: 'academic',
      source: 'dira',
      kind: 'effort',
      requiredEffortMin: 480,
      completedEffortMin: v.prepCompletedMin,
      flexibility: 'FLEXIBLE',
      criticality: 'HIGH',
      owner: USER_ID,
      goalIds: ['goal-econ-grade'],
    },
    {
      ...base,
      id: IDS.ps6,
      title: 'ECON 402 Problem Set 6',
      domain: 'academic',
      source: 'syllabus',
      kind: 'effort',
      deadlineMin: at(2, 23, 59), // Thursday 11:59 PM, hard
      requiredEffortMin: 120,
      completedEffortMin: 0,
      flexibility: 'FLEXIBLE',
      criticality: 'HIGH',
      owner: USER_ID,
      goalIds: ['goal-econ-grade'],
    },
    {
      ...base,
      id: IDS.interview,
      title: 'TechCorp technical interview',
      domain: 'career',
      source: 'gmail',
      sourceReference: 'gmail-thread-jordan-original',
      kind: 'event',
      startMin: at(1, 17), // Wednesday 5:00 PM
      durationMin: 60,
      flexibility: 'MOVE_WITHIN_WINDOW',
      criticality: 'CRITICAL',
      owner: USER_ID,
      participants: [USER_ID, PEOPLE.recruiter.id],
      externalSystem: 'recruiter',
      externalId: `cal-${IDS.interview}`,
      goalIds: ['goal-swe-offer'],
    },
    {
      ...base,
      id: IDS.presentation,
      title: 'Sponsor presentation (CS Club)',
      domain: 'organization',
      source: 'org-tracker',
      kind: 'event',
      startMin: at(1, 19), // Wednesday 7:00 PM, externally fixed
      durationMin: 60,
      flexibility: 'FIXED',
      criticality: 'CRITICAL',
      owner: USER_ID,
      participants: [USER_ID, PEOPLE.maya.id, 'sponsor-reps'],
      externalSystem: 'calendar',
      externalId: `cal-${IDS.presentation}`,
    },
    {
      ...base,
      id: IDS.assetsArrival,
      title: 'Sponsor logo assets arrive',
      domain: 'organization',
      source: 'org-tracker',
      kind: 'event',
      startMin: at(1, 14), // Wednesday 2:00 PM
      durationMin: 0,
      flexibility: 'FIXED',
      criticality: 'NORMAL',
      owner: 'sponsor-reps',
      participants: [],
    },
    {
      ...base,
      id: IDS.deckFreeze,
      title: 'Sponsor deck freeze',
      domain: 'organization',
      source: 'org-tracker',
      kind: 'event',
      startMin: at(1, 16), // Wednesday 4:00 PM — deck locks for the venue AV team
      durationMin: 0,
      flexibility: 'FIXED',
      criticality: 'HIGH',
      owner: USER_ID,
      participants: [USER_ID, PEOPLE.maya.id],
    },
    {
      ...base,
      id: IDS.qa,
      title: 'Sponsor deck visual QA',
      domain: 'organization',
      source: 'org-tracker',
      kind: 'effort',
      // Planned session: Wed 14:30–15:30, inside [assets arrive, deck freeze].
      startMin: at(1, 14, 30),
      durationMin: 60,
      requiredEffortMin: 60,
      completedEffortMin: 0,
      flexibility: 'DELEGATABLE',
      criticality: 'HIGH',
      owner: USER_ID,
      externalSystem: 'organization',
      externalId: 'org-task-visual-qa',
    },
    {
      ...base,
      id: IDS.workout,
      title: 'Workout',
      domain: 'personal',
      source: 'calendar',
      kind: 'block',
      startMin: workoutStart,
      durationMin: 60,
      flexibility: 'OPTIONAL',
      criticality: 'LOW',
      owner: USER_ID,
      externalSystem: 'calendar',
      externalId: `cal-${IDS.workout}`,
    },
    {
      ...base,
      id: IDS.sideProject,
      title: 'Side-project build block',
      domain: 'personal',
      source: 'calendar',
      kind: 'block',
      startMin: at(1, 9), // Wednesday morning
      durationMin: v.personalBlockDurationMin,
      flexibility: 'FLEXIBLE',
      criticality: 'LOW',
      owner: USER_ID,
      externalSystem: 'calendar',
      externalId: `cal-${IDS.sideProject}`,
    },
    // Initial study plan (PRD §5.1): Wed evening 2h, Thu evening 2.5h,
    // Fri morning 1.5h — as transparent reservations of free focus windows.
    ...studyReservation('wed-evening-prep', at(1, 20, 30), 120, now),
    ...studyReservation('thu-evening-prep-1', at(2, 19), 105, now),
    ...studyReservation('thu-evening-prep-2', at(2, 21, 15), 45, now),
    ...studyReservation('fri-morning-prep-1', at(3, 8, 30), 60, now),
    ...studyReservation('fri-morning-prep-2', at(3, 10), 30, now),
  ];

  const state: DomainState = {
    userId: USER_ID,
    timezone: 'America/Chicago',
    horizonStartIso: HORIZON_START_ISO,
    horizonEndMin: HORIZON_END_MIN,
    commitments: Object.fromEntries(commitments.map((c) => [c.id, c])),
    edges: [
      { id: 'edge-prep', type: 'REQUIRES_PREPARATION', from: IDS.exam, to: IDS.prep, data: { finalBufferMin: 0 } },
      {
        id: 'edge-recovery-buffer', type: 'REQUIRES_BUFFER', from: IDS.exam, to: IDS.interview,
        data: { bufferMin: 180, provenance: 'POST_EXAM_RECOVERY_BUFFER' },
      },
      { id: 'edge-pres-freeze', type: 'DEPENDS_ON', from: IDS.presentation, to: IDS.deckFreeze },
      { id: 'edge-freeze-qa', type: 'DEPENDS_ON', from: IDS.deckFreeze, to: IDS.qa },
      { id: 'edge-qa-follow-assets', type: 'MUST_FOLLOW', from: IDS.qa, to: IDS.assetsArrival },
      { id: 'edge-qa-precede-freeze', type: 'MUST_PRECEDE', from: IDS.qa, to: IDS.deckFreeze },
      { id: 'edge-freeze-precede-pres', type: 'MUST_PRECEDE', from: IDS.deckFreeze, to: IDS.presentation },
      {
        id: 'edge-qa-delegate', type: 'DELEGATABLE_TO', from: IDS.qa, to: v.backupOwner,
        data: { provenance: 'user_policy_config' },
      },
      { id: 'edge-prep-ps6', type: 'SHARES_RESOURCE_WITH', from: IDS.prep, to: IDS.ps6, data: { resource: 'user-time' } },
      { id: 'edge-workout-prep', type: 'SHARES_RESOURCE_WITH', from: IDS.workout, to: IDS.prep, data: { resource: 'user-time' } },
      { id: 'edge-side-prep', type: 'SHARES_RESOURCE_WITH', from: IDS.sideProject, to: IDS.prep, data: { resource: 'user-time' } },
      { id: 'edge-prep-goal', type: 'SUPPORTS_GOAL', from: IDS.prep, to: 'goal-econ-grade' },
      { id: 'edge-interview-goal', type: 'SUPPORTS_GOAL', from: IDS.interview, to: 'goal-swe-offer' },
    ],
    people: {
      [PEOPLE.user.id]: { ...PEOPLE.user, authorityDomains: [] },
      [PEOPLE.maya.id]: { ...PEOPLE.maya, availability: [{ start: at(1, 9), end: at(1, 18) }] },
      [PEOPLE.tunde.id]: { ...PEOPLE.tunde, availability: [{ start: at(1, 9), end: at(1, 18) }] },
      [PEOPLE.professor.id]: { ...PEOPLE.professor, authorityDomains: ['academic'] },
      [PEOPLE.recruiter.id]: { ...PEOPLE.recruiter, authorityDomains: ['career'] },
    },
    constraints: {
      'post-exam-recovery-buffer': {
        id: 'post-exam-recovery-buffer',
        key: 'POST_EXAM_RECOVERY_BUFFER',
        valueMin: 180,
        description: 'No demanding external commitment within 3h after an exam',
        provenance: 'user_policy_config',
      },
    },
    // Declared focus windows — when Sam can realistically do deep work.
    availability: [
      { start: at(0, 19, 30), end: at(0, 23) },   // Tue evening
      { start: at(1, 9), end: at(1, 13) },        // Wed morning
      { start: at(1, 14, 30), end: at(1, 16, 45) }, // Wed afternoon
      { start: at(1, 18), end: at(1, 19) },       // Wed pre-presentation hour
      { start: at(1, 20, 30), end: at(1, 22, 30) }, // Wed evening
      { start: at(2, 11), end: at(2, 12) },       // Thu late morning
      { start: at(2, 19), end: at(2, 20, 45) },   // Thu evening 1
      { start: at(2, 21, 15), end: at(2, 22, 30) }, // Thu evening 2
      { start: at(3, 8, 30), end: at(3, 9, 30) }, // Fri morning 1
      { start: at(3, 10), end: at(3, 11, 15) },   // Fri morning 2
    ],
    approvedSlots: {
      [IDS.interview]: [
        { startMin: at(2, 10), durationMin: 60, provenance: SLOT_PROVENANCE },
        { startMin: at(2, 13), durationMin: 60, provenance: SLOT_PROVENANCE },
      ] satisfies ApprovedSlot[],
    },
    config: { ...DEFAULT_ENGINE_CONFIG },
  };

  const calendarSeed: CalendarEvent[] = [
    cal(IDS.exam, 'ECON 402 Midterm 2', at(3, 14), at(3, 15)),
    cal(IDS.interview, 'TechCorp technical interview', at(1, 17), at(1, 18)),
    cal(IDS.presentation, 'Sponsor presentation (CS Club)', at(1, 19), at(1, 20)),
    cal(IDS.workout, 'Workout', workoutStart, workoutStart + 60),
    cal(IDS.sideProject, 'Side-project build block', at(1, 9), at(1, 9) + v.personalBlockDurationMin),
    cal('wed-evening-prep', 'Study: ECON 402', at(1, 20, 30), at(1, 22, 30)),
    cal('thu-evening-prep-1', 'Study: ECON 402', at(2, 19), at(2, 20, 45)),
    cal('thu-evening-prep-2', 'Study: ECON 402', at(2, 21, 15), at(2, 22)),
    cal('fri-morning-prep-1', 'Study: ECON 402', at(3, 8, 30), at(3, 9, 30)),
    cal('fri-morning-prep-2', 'Study: ECON 402', at(3, 10), at(3, 10, 30)),
  ];

  const orgSeed: OrgTask[] = [
    {
      id: 'org-task-visual-qa',
      title: 'Sponsor deck visual QA',
      owner: USER_ID,
      dueIso: iso(at(1, 16)),
      status: 'OPEN',
    },
  ];

  const recruiterSlots = {
    interviewId: IDS.interview,
    slots: [
      {
        slotId: 'slot-thu-1000',
        startIso: iso(at(2, 10)),
        endIso: iso(at(2, 11)),
        actuallyAvailable: !v.firstSlotTaken && !v.bothSlotsTaken,
      },
      {
        slotId: 'slot-thu-1300',
        startIso: iso(at(2, 13)),
        endIso: iso(at(2, 14)),
        actuallyAvailable: !v.bothSlotsTaken,
      },
    ] satisfies SlotState[],
  };

  const examLabel = `${v.examHour === 13 ? '1:00' : v.examHour === 14 ? '2:00' : '3:00'} PM`;
  const trigger: RawEmailEvent = {
    eventId: 'evt-gmail-econ-move-1',
    source: 'gmail',
    threadId: 'thread-econ402-announcements',
    messageId: 'msg-prof-econ-move-1',
    from: PEOPLE.professor.email,
    to: 'sam.adeyemi@student.demo',
    subject: 'ECON 402 — Midterm 2 schedule change',
    body:
      `Dear class,\n\nDue to a department facilities conflict, Midterm 2 will be held ` +
      `this Wednesday at ${examLabel} instead of Friday at 2:00 PM. The exam room is ` +
      `unchanged. Problem Set 6 is still due Thursday at 11:59 PM.\n\n` +
      `Apologies for the short notice.\nProf. Chen`,
    receivedAtIso: now,
  };

  const interpretation: InterpretationResult = {
    relevant: true,
    reason: 'Professor announcement moves an existing exam commitment',
    mutation: {
      entity_type: 'commitment',
      entity_id: IDS.exam,
      mutation_type: 'schedule_change',
      old_start: iso(at(3, 14)),
      new_start: iso(at(1, v.examHour)),
      unchanged_constraints: ['problem-set-6-deadline'],
      confidence: 0.99,
      evidence_quote: `Midterm 2 will be held this Wednesday at ${examLabel} instead of Friday at 2:00 PM`,
    },
  };

  const inboxSeed: GmailMessage[] = [
    {
      threadId: trigger.threadId,
      messageId: trigger.messageId,
      from: trigger.from,
      to: trigger.to,
      subject: trigger.subject,
      body: trigger.body,
    },
    {
      threadId: SLOT_PROVENANCE,
      messageId: 'msg-jordan-alt-slots',
      from: PEOPLE.recruiter.email,
      to: 'sam.adeyemi@student.demo',
      subject: 'Interview scheduling — alternatives',
      body:
        'If Wednesday 5 PM ever stops working, I can also do Thursday 10:00 AM or ' +
        'Thursday 1:00 PM. Just book whichever works.\n— Jordan',
    },
  ];

  return { state, calendarSeed, orgSeed, recruiterSlots, inboxSeed, trigger, interpretation, variation: v };
}

function studyReservation(id: string, start: number, duration: number, now: string): Commitment[] {
  return [
    {
      id,
      userId: USER_ID,
      title: 'Study: ECON 402',
      domain: 'academic',
      source: 'dira',
      status: 'PLANNED',
      kind: 'block',
      startMin: start,
      durationMin: duration,
      reservesEffortFor: IDS.prep,
      flexibility: 'FLEXIBLE',
      criticality: 'NORMAL',
      owner: USER_ID,
      participants: [USER_ID],
      goalIds: ['goal-econ-grade'],
      resourceRequirements: ['user-time'],
      externalSystem: 'calendar',
      externalId: `cal-${id}`,
      confidence: 1,
      createdAtIso: now,
      updatedAtIso: now,
    },
  ];
}

import type { Interval } from './time.js';

/** PRD §10 — how much latitude Dira has to alter a commitment. */
export type Flexibility =
  | 'FIXED'
  | 'MOVE_WITHIN_WINDOW'
  | 'FLEXIBLE'
  | 'DELEGATABLE'
  | 'OPTIONAL';

export type Criticality = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

export type CommitmentStatus =
  | 'PLANNED'
  | 'READY'
  | 'IN_PROGRESS'
  | 'COMPLETE'
  | 'AT_RISK'
  | 'DROPPED';

export type Domain = 'academic' | 'career' | 'organization' | 'personal';

/**
 * The engine distinguishes three shapes of commitment:
 *  - `event`  — occupies a concrete interval (exam, interview, presentation)
 *  - `effort` — requires N minutes of focused work before a deadline
 *               (exam prep, problem set, visual QA)
 *  - `block`  — a scheduled reservation of the user's time that can move
 *               (workout, side-project block, planned study sessions)
 */
export type CommitmentKind = 'event' | 'effort' | 'block';

/** PRD §9 — the core entity. Times are minutes from the horizon start. */
export interface Commitment {
  id: string;
  userId: string;
  title: string;
  domain: Domain;
  source: string;
  sourceReference?: string;
  status: CommitmentStatus;
  kind: CommitmentKind;

  /** events + blocks: scheduled interval */
  startMin?: number;
  durationMin?: number;

  /**
   * blocks only: this block is a reservation of free capacity for a pooled
   * effort commitment (e.g. a study block for exam prep). Reservations are
   * transparent to capacity math — the solver draws the effort from the same
   * free time the reservation sits in, so counting both would double-book.
   */
  reservesEffortFor?: string;

  /** effort: hard completion deadline (minutes) */
  deadlineMin?: number;
  /** effort: earliest minute work may begin (e.g. assets arrive Wed 14:00) */
  releaseMin?: number;
  requiredEffortMin?: number;
  completedEffortMin?: number;

  flexibility: Flexibility;
  criticality: Criticality;

  owner: string;
  participants: string[];

  goalIds: string[];
  resourceRequirements: string[];

  /** Which external system materializes this commitment, for executor routing. */
  externalSystem?: 'calendar' | 'recruiter' | 'organization' | 'gmail';
  externalId?: string;

  autonomyScope?: string;
  confidence: number;

  createdAtIso: string;
  updatedAtIso: string;
}

/** PRD §11 — typed edges. */
export type EdgeType =
  | 'DEPENDS_ON'
  | 'REQUIRES_PREPARATION'
  | 'REQUIRES_BUFFER'
  | 'CONFLICTS_WITH'
  | 'SUPPORTS_GOAL'
  | 'OWNED_BY'
  | 'DELEGATABLE_TO'
  | 'BLOCKED_BY'
  | 'MUST_PRECEDE'
  | 'MUST_FOLLOW'
  | 'SHARES_RESOURCE_WITH';

export interface CommitmentEdge {
  id: string;
  type: EdgeType;
  /** source commitment id (or person id for OWNED_BY/DELEGATABLE_TO targets) */
  from: string;
  to: string;
  data?: {
    /** REQUIRES_BUFFER: minimum gap in minutes between from.end and to.start */
    bufferMin?: number;
    /** REQUIRES_PREPARATION: minutes before start by which prep must complete */
    finalBufferMin?: number;
    /** SHARES_RESOURCE_WITH: named resource */
    resource?: string;
    /** Free-text provenance for why this edge exists */
    provenance?: string;
  };
}

export interface Person {
  id: string;
  name: string;
  email: string;
  /** availability intervals for delegation feasibility checks */
  availability?: Interval[];
  /**
   * Domains this person has authority to mutate via email (a professor can
   * move an exam; a recruiter can move an interview; a stranger can move
   * nothing). Part of the prompt-injection surface reduction (PRD §47).
   */
  authorityDomains?: Domain[];
}

export interface NamedConstraint {
  id: string;
  description: string;
  /** e.g. POST_EXAM_RECOVERY_BUFFER */
  key: string;
  valueMin: number;
  provenance: string;
}

/** Engine configuration constants — deliberately explicit and unit-tested. */
export interface EngineConfig {
  /**
   * Minutes lost to context-switching per distinct work session. A 60-minute
   * gap yields 54 usable minutes. Keeps capacity math honest: ten scattered
   * ten-minute gaps are not 100 minutes of usable study time.
   */
  sessionOverheadMin: number;
  /**
   * A repair is only acceptable if it restores at least this much global
   * slack. Autonomous systems should not repair a schedule onto a knife edge.
   */
  repairSlackMarginMin: number;
  /** Confidence below which interpretations are routed to WAITING_REVIEW. */
  minInterpretationConfidence: number;
  /** Max executor attempts for transient failures. */
  maxTransientRetries: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  sessionOverheadMin: 6,
  repairSlackMarginMin: 60,
  minInterpretationConfidence: 0.8,
  maxTransientRetries: 3,
};

/** A recruiter-offered interview slot with provenance. */
export interface ApprovedSlot {
  startMin: number;
  durationMin: number;
  provenance: string;
}

/** The full in-memory world model the engines operate on. */
export interface DomainState {
  userId: string;
  /** User's IANA timezone (for display and local-time planning). Legacy snapshots may omit it. */
  timezone?: string;
  horizonStartIso: string;
  /** exclusive horizon end, minutes */
  horizonEndMin: number;
  commitments: Record<string, Commitment>;
  edges: CommitmentEdge[];
  people: Record<string, Person>;
  constraints: Record<string, NamedConstraint>;
  /** Declared focus-time windows: when the user can realistically do deep work. */
  availability: Interval[];
  /** Recruiter-approved alternatives for MOVE_WITHIN_WINDOW commitments. */
  approvedSlots: Record<string, ApprovedSlot[]>;
  config: EngineConfig;
}

export function cloneState(state: DomainState): DomainState {
  return structuredClone(state);
}

export function getCommitment(state: DomainState, id: string): Commitment {
  const c = state.commitments[id];
  if (!c) throw new Error(`Unknown commitment: ${id}`);
  return c;
}

export function eventInterval(c: Commitment): Interval {
  if (c.startMin === undefined || c.durationMin === undefined) {
    throw new Error(`Commitment ${c.id} has no scheduled interval`);
  }
  return { start: c.startMin, end: c.startMin + c.durationMin };
}

export function remainingEffortMin(c: Commitment): number {
  return Math.max(0, (c.requiredEffortMin ?? 0) - (c.completedEffortMin ?? 0));
}

import { z } from 'zod';

/**
 * PRD §8 — every model output must validate against strict schemas before it
 * touches the planning layer. Nothing an email says can reach an executor
 * except through these shapes.
 */

export const RawEmailEventSchema = z.object({
  eventId: z.string().min(1),
  /** gmail is an email delivery; gemma_voice_note is a user-owned recording
   * transcribed by the optional Gemma 3n service. Both remain untrusted input. */
  /** user_note is the owner's own words relayed through chat (Hermes) and confirmed in the web app. */
  /** web_page is a Tavily search result from a domain the owner named as an official source. */
  source: z.enum(['gmail', 'gemma_voice_note', 'user_note', 'web_page']),
  threadId: z.string().min(1),
  messageId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  subject: z.string(),
  body: z.string(),
  receivedAtIso: z.string(),
});
export type RawEmailEvent = z.infer<typeof RawEmailEventSchema>;

/**
 * Raw user audio for the optional Gemma 3n intake service. Audio is never
 * handed to the planner: Gemma returns a transcript, which re-enters Dira as
 * an untrusted gemma_voice_note event and must pass every normal gate.
 */
export const RawVoiceNoteSchema = z.object({
  eventId: z.string().min(1),
  noteId: z.string().min(1),
  recordedBy: z.string().email(),
  audioBase64: z.string().min(32).max(8_000_000),
  mimeType: z.enum(['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/webm']),
  receivedAtIso: z.string().datetime({ offset: true }),
});
export type RawVoiceNote = z.infer<typeof RawVoiceNoteSchema>;

export const MutationTypeSchema = z.enum([
  'schedule_change',
  'deadline_change',
  'cancellation',
  'new_commitment',
  'offer_of_alternatives',
  'unrelated',
]);

/** Structured mutation extracted from an email (PRD §8 example). */
export const InterpretedMutationSchema = z
  .object({
    entity_type: z.enum(['commitment']),
    entity_id: z.string().min(1),
    mutation_type: MutationTypeSchema,
    old_start: z.string().datetime({ offset: true }).optional(),
    new_start: z.string().datetime({ offset: true }).optional(),
    /**
     * offer_of_alternatives: the sender proposed times but did not fix one.
     * Each entry must be quotable back to the message (provenance).
     */
    offered_alternatives: z
      .array(z.string().datetime({ offset: true }))
      .optional(),
    unchanged_constraints: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1),
    evidence_quote: z.string().optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    // A mutation the executor cannot apply is malformed, whatever the model
    // says: reschedules need the new time; offers need the alternatives.
    if ((m.mutation_type === 'schedule_change' || m.mutation_type === 'deadline_change') && !m.new_start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${m.mutation_type} requires new_start`,
        path: ['new_start'],
      });
    }
    if (m.mutation_type === 'offer_of_alternatives' && !(m.offered_alternatives?.length)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'offer_of_alternatives requires offered_alternatives',
        path: ['offered_alternatives'],
      });
    }
  });
export type InterpretedMutation = z.infer<typeof InterpretedMutationSchema>;

/** Classification wrapper: not every email is a mutation. */
export const InterpretationResultSchema = z
  .object({
    relevant: z.boolean(),
    reason: z.string(),
    mutation: InterpretedMutationSchema.nullable(),
  })
  .strict();
export type InterpretationResult = z.infer<typeof InterpretationResultSchema>;

/** PRD §14 — one propagated effect, inspectable and testable. */
export const ImpactRecordSchema = z.object({
  source_commitment: z.string(),
  affected_commitment: z.string(),
  edge_type: z.string(),
  constraint: z.string(),
  previous_status: z.enum(['SATISFIED', 'VIOLATED', 'NOT_APPLICABLE']),
  new_status: z.enum(['SATISFIED', 'VIOLATED', 'NOT_APPLICABLE']),
  detail: z.string().optional(),
});
export type ImpactRecord = z.infer<typeof ImpactRecordSchema>;

export const ViolationSchema = z.object({
  type: z.enum([
    'INSUFFICIENT_PREP_CAPACITY',
    'INSUFFICIENT_CAPACITY',
    'BUFFER_VIOLATION',
    'OVERLAP',
    'ORDERING_VIOLATION',
    'ASSIGNEE_UNAVAILABLE',
    'DEADLINE_UNMEETABLE',
    'DEPENDENCY_UNSATISFIED',
    'UNSCHEDULED',
  ]),
  commitment_id: z.string(),
  detail: z.string(),
  deficit_minutes: z.number().optional(),
});
export type Violation = z.infer<typeof ViolationSchema>;

/** PRD §18 — the deterministic solver's verdict. The LLM never invents this. */
export const FeasibilityResultSchema = z.object({
  feasible: z.boolean(),
  global_slack_minutes: z.number(),
  violations: z.array(ViolationSchema),
  paths: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      slack_minutes: z.number().nullable(),
      kind: z.enum(['capacity', 'buffer', 'assignment']),
    }),
  ),
});
export type FeasibilityResult = z.infer<typeof FeasibilityResultSchema>;

/** Action types the executor understands. Everything else is DENY by policy. */
export const ActionTypeSchema = z.enum([
  'BOOK_INTERVIEW_SLOT',
  'MOVE_CALENDAR_EVENT',
  'CREATE_CALENDAR_EVENT',
  'DELETE_CALENDAR_EVENT',
  'DELEGATE_TASK',
  'SEND_NOTIFICATION',
  'DECLINE_INTERVIEW',
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const PlannedActionSchema = z.object({
  type: ActionTypeSchema,
  target: z.string(),
  desired_state: z.record(z.unknown()),
  /** PRD §22 — no provenance, no execution. */
  provenance: z.array(z.string()).min(1),
  external_system: z.enum(['calendar', 'recruiter', 'organization', 'gmail']),
  summary: z.string(),
});
export type PlannedAction = z.infer<typeof PlannedActionSchema>;

export const CandidatePlanSchema = z.object({
  id: z.string(),
  label: z.string(),
  actions: z.array(PlannedActionSchema),
  /** internal (non-external) state edits, e.g. rebuilt study placement */
  notes: z.array(z.string()).default([]),
});
export type CandidatePlan = z.infer<typeof CandidatePlanSchema>;

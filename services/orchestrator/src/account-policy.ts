import { z } from 'zod';

const domains = ['academic', 'career', 'organization', 'personal'] as const;

const RuleLabel = z.string().trim().min(1).max(160);
const RuleId = z.string().regex(/^rule-[a-z0-9-]{4,64}$/);
/** Confirmed correction rules (see @dira/policy-engine CorrectionRule). They only tighten policy. */
export const CorrectionRuleSchema = z.discriminatedUnion('kind', [
  z.object({ id: RuleId, kind: z.literal('PROTECT_COMMITMENT'), commitmentId: z.string().min(1).max(256), label: RuleLabel }).strict(),
  z.object({
    id: RuleId, kind: z.literal('AVOID_WINDOW'),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440), label: RuleLabel,
  }).strict(),
  z.object({ id: RuleId, kind: z.literal('NEVER_CONTACT'), personId: z.string().min(1).max(256), label: RuleLabel }).strict(),
  z.object({
    id: RuleId, kind: z.literal('ASK_FIRST'),
    actionType: z.enum(['MOVE_CALENDAR_EVENT', 'CREATE_CALENDAR_EVENT', 'DELETE_CALENDAR_EVENT', 'DELEGATE_TASK', 'SEND_NOTIFICATION', 'BOOK_INTERVIEW_SLOT']),
    label: RuleLabel,
  }).strict(),
]).superRefine((rule, context) => {
  if (rule.kind === 'AVOID_WINDOW' && rule.endMinute <= rule.startMinute) {
    context.addIssue({ code: 'custom', path: ['endMinute'], message: 'The window must end after it starts.' });
  }
});
export type StoredCorrectionRule = z.infer<typeof CorrectionRuleSchema>;
const overrideableRules = [
  'move-flexible-or-optional-blocks',
  'restructure-study-blocks',
  'delegate-explicitly-delegatable',
  'sync-calendar-with-approved-booking',
  'interview-slots-recruiter-approved-only',
] as const;

export const AccountPolicySettingsSchema = z.object({
  schemaVersion: z.literal(1),
  fencedCalendarIds: z.array(z.literal('primary')).max(1).default([]),
  fencedPersonIds: z.array(z.string().min(1).max(256)).max(500).default([])
    .refine((ids) => new Set(ids).size === ids.length, 'Choose each fenced contact once.'),
  fencedGmail: z.boolean().default(false),
  calendarAutoSync: z.boolean().default(false),
  gmailAutoSync: z.boolean().default(false),
  /** Outbound messages land in Drafts until the owner turns this off. */
  draftOnly: z.boolean().default(true),
  /** Delete flight records older than this many days (0 keeps them). */
  flightRetentionDays: z.number().int().min(0).max(365).default(30),
  /** Owner-confirmed correction rules. Changed only through the rules API. */
  correctionRules: z.array(CorrectionRuleSchema).max(100).default([]),
  requireApproval: z.array(z.object({
    rule: z.enum(overrideableRules),
    scope: z.object({
      domain: z.enum(domains).optional(),
      commitmentId: z.string().min(1).max(256).optional(),
      personId: z.string().min(1).max(256).optional(),
    }).strict().optional(),
  }).strict()).max(100),
}).strict().superRefine((settings, context) => {
  const seen = new Set<string>();
  settings.requireApproval.forEach((entry, index) => {
    const key = `${entry.rule}:${entry.scope?.domain ?? ''}:${entry.scope?.commitmentId ?? ''}:${entry.scope?.personId ?? ''}`;
    if (seen.has(key)) context.addIssue({
      code: 'custom', path: ['requireApproval', index], message: 'Duplicate approval rule and scope.',
    });
    seen.add(key);
  });
});

export type AccountPolicySettings = z.infer<typeof AccountPolicySettingsSchema>;

export const DEFAULT_ACCOUNT_POLICY: AccountPolicySettings = {
  schemaVersion: 1,
  fencedCalendarIds: [],
  fencedPersonIds: [],
  fencedGmail: false,
  calendarAutoSync: false,
  gmailAutoSync: false,
  draftOnly: true,
  flightRetentionDays: 30,
  correctionRules: [],
  requireApproval: [],
};

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** One plain sentence per rule, shared by the web app, memory files, and Hermes Skills. */
export function describeCorrectionRule(rule: StoredCorrectionRule): string {
  switch (rule.kind) {
    case 'PROTECT_COMMITMENT':
      return `Never move, remove, or hand off ${rule.label}.`;
    case 'AVOID_WINDOW': {
      const days = rule.weekdays.length === 7 ? 'every day'
        : rule.weekdays.map((day) => WEEKDAY_NAMES[day]).join(', ');
      return `Keep ${days} from ${clockLabel(rule.startMinute)} to ${clockLabel(rule.endMinute)} free when moving or adding blocks.`;
    }
    case 'NEVER_CONTACT':
      return `Never message or delegate to ${rule.label}.`;
    case 'ASK_FIRST':
      return `Always ask before Dira will ${rule.label}.`;
  }
}

function clockLabel(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  const mins = minute % 60;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${mins ? `:${String(mins).padStart(2, '0')}` : ''} ${suffix}`;
}

import { z } from 'zod';

const domains = ['academic', 'career', 'organization', 'personal'] as const;
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
  requireApproval: [],
};

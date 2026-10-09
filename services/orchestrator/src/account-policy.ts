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
  requireApproval: [],
};

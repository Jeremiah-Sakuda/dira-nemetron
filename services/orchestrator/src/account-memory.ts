import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_ENGINE_CONFIG, isoToMinutes, minutesToIso, type DomainState } from '@dira/commitment-model';
import { z } from 'zod';
import { AvailabilityProfileSchema, type AvailabilityProfile } from './account-planning.js';
import { AccountPolicySettingsSchema, DEFAULT_ACCOUNT_POLICY, type AccountPolicySettings } from './account-policy.js';

const execFile = promisify(execFileCallback);
const repositoryRoot = process.env.DIRA_MEMORY_ROOT ?? '.dira-memory';
const locks = new Map<string, Promise<unknown>>();
const Int = z.number().int().safe();
const SafeId = z.string().min(1).max(256).refine((value) => !['__proto__', 'constructor', 'prototype'].includes(value));
const IntervalSchema = z.object({ start: Int, end: Int }).refine((value) => value.end > value.start);
const AbsoluteTimesSchema = z.object({
  startIso: z.string().datetime({ offset: true }).optional(),
  endIso: z.string().datetime({ offset: true }).optional(),
  deadlineIso: z.string().datetime({ offset: true }).optional(),
  releaseIso: z.string().datetime({ offset: true }).optional(),
});
const CommitmentSchema = z.object({
  id: SafeId, userId: z.string().min(1), title: z.string(),
  domain: z.enum(['academic', 'career', 'organization', 'personal']),
  source: z.string(), sourceReference: z.string().optional(),
  status: z.enum(['PLANNED', 'READY', 'IN_PROGRESS', 'COMPLETE', 'AT_RISK', 'DROPPED']),
  kind: z.enum(['event', 'effort', 'block']), startMin: Int.optional(), durationMin: Int.positive().optional(),
  reservesEffortFor: z.string().optional(), deadlineMin: Int.optional(), releaseMin: Int.optional(),
  requiredEffortMin: Int.nonnegative().optional(), completedEffortMin: Int.nonnegative().optional(),
  flexibility: z.enum(['FIXED', 'MOVE_WITHIN_WINDOW', 'FLEXIBLE', 'DELEGATABLE', 'OPTIONAL']),
  criticality: z.enum(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']), owner: z.string(),
  participants: z.array(z.string()), goalIds: z.array(z.string()), resourceRequirements: z.array(z.string()),
  externalSystem: z.enum(['calendar', 'recruiter', 'organization', 'gmail']).optional(),
  externalId: z.string().optional(), autonomyScope: z.string().optional(),
  confidence: z.number().min(0).max(1), createdAtIso: z.string().datetime({ offset: true }),
  updatedAtIso: z.string().datetime({ offset: true }), absoluteTimes: AbsoluteTimesSchema.optional(),
});
const EdgeSchema = z.object({
  id: SafeId, type: z.enum([
    'DEPENDS_ON', 'REQUIRES_PREPARATION', 'REQUIRES_BUFFER', 'CONFLICTS_WITH', 'SUPPORTS_GOAL',
    'OWNED_BY', 'DELEGATABLE_TO', 'BLOCKED_BY', 'MUST_PRECEDE', 'MUST_FOLLOW', 'SHARES_RESOURCE_WITH',
  ]), from: SafeId, to: SafeId,
  data: z.object({ bufferMin: Int.nonnegative().optional(), finalBufferMin: Int.nonnegative().optional(),
    resource: z.string().optional(), provenance: z.string().optional() }).optional(),
});
const PersonSchema = z.object({
  id: SafeId, name: z.string(), email: z.string(), availability: z.array(IntervalSchema).optional(),
  authorityDomains: z.array(z.enum(['academic', 'career', 'organization', 'personal'])).optional(),
});
const ConstraintSchema = z.object({ id: SafeId, description: z.string(), key: z.string(),
  valueMin: Int, provenance: z.string() });
const ApprovedSlotSchema = z.object({ startMin: Int, durationMin: Int.positive(), provenance: z.string() });
const ConfigSchema = z.object({ sessionOverheadMin: Int.nonnegative(), repairSlackMarginMin: Int.nonnegative(),
  minInterpretationConfidence: z.number().min(0).max(1), maxTransientRetries: Int.nonnegative() });
const GraphSnapshotSchema = z.object({
  schemaVersion: z.literal(1), ownerAccountId: z.string().min(1).optional(), timezone: z.string().min(1),
  horizonStartIso: z.string().datetime({ offset: true }), horizonEndMin: Int.positive().max(5_256_000),
  commitments: z.record(SafeId, CommitmentSchema), edges: z.array(EdgeSchema),
  people: z.record(SafeId, PersonSchema), constraints: z.record(SafeId, ConstraintSchema),
  approvedSlots: z.record(SafeId, z.array(ApprovedSlotSchema)), config: ConfigSchema.optional(),
}).superRefine((graph, context) => {
  for (const [id, commitment] of Object.entries(graph.commitments)) {
    if (id !== commitment.id) context.addIssue({ code: 'custom', path: ['commitments', id, 'id'], message: 'Commitment key does not match its id.' });
    if (graph.ownerAccountId && commitment.userId !== graph.ownerAccountId) context.addIssue({ code: 'custom', path: ['commitments', id, 'userId'], message: 'Commitment belongs to another account.' });
  }
  for (const [id, person] of Object.entries(graph.people)) {
    if (id !== person.id) context.addIssue({ code: 'custom', path: ['people', id, 'id'], message: 'Person key does not match its id.' });
  }
  for (const [id, constraint] of Object.entries(graph.constraints)) {
    if (id !== constraint.id) context.addIssue({ code: 'custom', path: ['constraints', id, 'id'], message: 'Constraint key does not match its id.' });
  }
  for (const id of Object.keys(graph.approvedSlots)) {
    if (!graph.commitments[id]) context.addIssue({ code: 'custom', path: ['approvedSlots', id], message: 'Approved slots target an unknown commitment.' });
  }
  for (const edge of graph.edges) {
    const fromExists = graph.commitments[edge.from] || graph.people[edge.from];
    const toExists = graph.commitments[edge.to] || graph.people[edge.to];
    if (!fromExists || !toExists) context.addIssue({ code: 'custom', path: ['edges', edge.id], message: 'Edge points to an unknown graph node.' });
  }
});
const AvailabilitySnapshotSchema = z.object({
  schemaVersion: z.literal(1), timezone: z.string().min(1),
  profile: AvailabilityProfileSchema.nullable(), focusWindows: z.array(IntervalSchema),
});
const RulesSnapshotSchema = z.object({ schemaVersion: z.literal(1), rules: z.array(z.unknown()) });

function accountDirectory(accountId: string): string {
  const key = createHash('sha256').update(accountId).digest('hex');
  return join(repositoryRoot, key);
}

async function git(directory: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', ['-C', directory, ...args], { maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim();
}

async function withAccountLock<T>(directory: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(directory) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  locks.set(directory, queued);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (locks.get(directory) === queued) locks.delete(directory);
  }
}

async function writePrivateFile(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function syncAccountMemory(
  accountId: string,
  loadSnapshot: () => Promise<{
    state: DomainState;
    profile: AvailabilityProfile | undefined;
    policy?: AccountPolicySettings;
  }>,
): Promise<{ commit: string; changed: boolean }> {
  const directory = accountDirectory(accountId);
  return withAccountLock(directory, async () => {
    const { state, profile, policy = DEFAULT_ACCOUNT_POLICY } = await loadSnapshot();
    await mkdir(repositoryRoot, { recursive: true, mode: 0o700 });
    await chmod(repositoryRoot, 0o700);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    try {
      await git(directory, 'rev-parse', '--git-dir');
    } catch {
      await git(directory, 'init', '--quiet');
      await git(directory, 'config', 'user.name', 'Dira');
      await git(directory, 'config', 'user.email', 'dira-memory@localhost');
      await git(directory, 'config', 'core.filemode', 'true');
    }

    const timeZone = state.timezone ?? 'UTC';
    const graph = {
      schemaVersion: 1,
      ownerAccountId: accountId,
      timezone: timeZone,
      horizonStartIso: state.horizonStartIso,
      horizonEndMin: state.horizonEndMin,
      commitments: Object.fromEntries(Object.entries(state.commitments).map(([id, commitment]) => [id, {
        ...commitment,
        absoluteTimes: {
          ...(commitment.startMin !== undefined
            ? { startIso: minutesToIso(commitment.startMin, state.horizonStartIso, timeZone) }
            : {}),
          ...(commitment.startMin !== undefined && commitment.durationMin !== undefined
            ? { endIso: minutesToIso(commitment.startMin + commitment.durationMin, state.horizonStartIso, timeZone) }
            : {}),
          ...(commitment.deadlineMin !== undefined
            ? { deadlineIso: minutesToIso(commitment.deadlineMin, state.horizonStartIso, timeZone) }
            : {}),
          ...(commitment.releaseMin !== undefined
            ? { releaseIso: minutesToIso(commitment.releaseMin, state.horizonStartIso, timeZone) }
            : {}),
        },
      }])),
      edges: state.edges,
      people: state.people,
      constraints: state.constraints,
      approvedSlots: state.approvedSlots,
      config: state.config,
    };
    const availability = {
      schemaVersion: 1,
      timezone: state.timezone ?? 'UTC',
      profile: profile ?? null,
      focusWindows: state.availability,
    };
    const validatedPolicy = AccountPolicySettingsSchema.parse(policy);
    await Promise.all([
      writePrivateFile(join(directory, 'graph.json'), `${JSON.stringify(graph, null, 2)}\n`),
      writePrivateFile(join(directory, 'availability.json'), `${JSON.stringify(availability, null, 2)}\n`),
      writePrivateFile(join(directory, 'policy.json'), `${JSON.stringify(validatedPolicy, null, 2)}\n`),
      mkdir(join(directory, 'rules'), { recursive: true, mode: 0o700 }),
    ]);
    const rulesPath = join(directory, 'rules', 'correction-rules.json');
    try {
      await readFile(rulesPath, 'utf8');
    } catch {
      await writePrivateFile(rulesPath, '{\n  "schemaVersion": 1,\n  "rules": []\n}\n');
    }

    await git(directory, 'add', '--', 'graph.json', 'availability.json', 'policy.json', 'rules/correction-rules.json');
    const changed = Boolean(await git(directory, 'status', '--porcelain'));
    if (changed) {
      await git(directory, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Update confirmed Dira memory');
    }
    return { commit: await git(directory, 'rev-parse', 'HEAD'), changed };
  });
}

export async function exportAccountMemory(accountId: string): Promise<Buffer> {
  const directory = accountDirectory(accountId);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'dira-memory-'));
  const bundlePath = join(temporaryDirectory, 'dira-memory.bundle');
  try {
    await git(directory, 'bundle', 'create', bundlePath, '--all');
    return await readFile(bundlePath);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export interface ImportedAccountMemory {
  state: DomainState;
  profile: AvailabilityProfile | undefined;
  policy: AccountPolicySettings;
  sourceCommit: string;
}

export async function importAccountMemoryBundle(accountId: string, bundle: Buffer): Promise<ImportedAccountMemory> {
  if (bundle.length === 0 || bundle.length > 25 * 1024 * 1024) {
    throw new Error('Memory bundle must be between 1 byte and 25 MiB.');
  }
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'dira-memory-import-'));
  await chmod(temporaryDirectory, 0o700);
  const bundlePath = join(temporaryDirectory, 'upload.bundle');
  const verificationRepository = join(temporaryDirectory, 'verify.git');
  const sourceRepository = join(temporaryDirectory, 'source.git');
  try {
    await writeFile(bundlePath, bundle, { mode: 0o600 });
    await chmod(bundlePath, 0o600);
    await git(temporaryDirectory, 'init', '--bare', '--quiet', verificationRepository);
    await git(verificationRepository, 'bundle', 'verify', bundlePath);
    await git(temporaryDirectory, 'clone', '--quiet', '--bare', bundlePath, sourceRepository);
    const [rawGraph, rawAvailability, rawPolicy, rawRules, sourceCommit] = await Promise.all([
      git(sourceRepository, 'show', 'HEAD:graph.json'),
      git(sourceRepository, 'show', 'HEAD:availability.json'),
      git(sourceRepository, 'show', 'HEAD:policy.json'),
      git(sourceRepository, 'show', 'HEAD:rules/correction-rules.json'),
      git(sourceRepository, 'rev-parse', 'HEAD'),
    ]);
    const graph = GraphSnapshotSchema.parse(JSON.parse(rawGraph));
    const availability = AvailabilitySnapshotSchema.parse(JSON.parse(rawAvailability));
    const rawPolicyValue = JSON.parse(rawPolicy) as unknown;
    const policy = parseMemoryPolicy(rawPolicyValue);
    const rules = RulesSnapshotSchema.parse(JSON.parse(rawRules));
    const inferredOwner = graph.ownerAccountId ?? Object.values(graph.commitments)[0]?.userId;
    if (inferredOwner !== accountId || Object.values(graph.commitments).some((commitment) => commitment.userId !== accountId)) {
      throw new Error('This memory bundle belongs to a different Dira account or does not identify its owner.');
    }
    if (availability.timezone !== graph.timezone) throw new Error('Memory bundle timezone values do not match.');
    if (rules.rules.length !== 0) {
      throw new Error('This Dira version cannot restore correction rules stored in this bundle.');
    }
    const commitments = Object.fromEntries(Object.entries(graph.commitments).map(([id, commitment]) => {
      const times = commitment.absoluteTimes;
      const startMin = times?.startIso ? isoToMinutes(times.startIso, graph.horizonStartIso) : commitment.startMin;
      const deadlineMin = times?.deadlineIso ? isoToMinutes(times.deadlineIso, graph.horizonStartIso) : commitment.deadlineMin;
      const releaseMin = times?.releaseIso ? isoToMinutes(times.releaseIso, graph.horizonStartIso) : commitment.releaseMin;
      let durationMin = commitment.durationMin;
      if (times?.endIso && startMin !== undefined) {
        durationMin = isoToMinutes(times.endIso, graph.horizonStartIso) - startMin;
        if (durationMin <= 0) throw new Error(`Commitment ${id} has an invalid absolute interval.`);
      }
      return [id, { ...commitment, startMin, durationMin, deadlineMin, releaseMin }];
    }));
    const state: DomainState = {
      userId: accountId,
      timezone: graph.timezone,
      horizonStartIso: graph.horizonStartIso,
      horizonEndMin: graph.horizonEndMin,
      commitments,
      edges: graph.edges,
      people: graph.people,
      constraints: graph.constraints,
      availability: [],
      approvedSlots: graph.approvedSlots,
      config: graph.config ?? { ...DEFAULT_ENGINE_CONFIG },
    };
    const directory = accountDirectory(accountId);
    await withAccountLock(directory, async () => {
      await git(directory, 'fetch', '--quiet', '--no-tags', bundlePath, `+${sourceCommit}:refs/imported/${sourceCommit}`);
    });
    return { state, profile: availability.profile ?? undefined, policy, sourceCommit };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function parseMemoryPolicy(value: unknown): AccountPolicySettings {
  const current = AccountPolicySettingsSchema.safeParse(value);
  if (current.success) return current.data;
  // Older v2 backups stored only the conservative baseline and no override data.
  const legacy = z.object({
    schemaVersion: z.literal(1), autonomy: z.literal('approval-required'),
    allowedActions: z.array(z.literal('google-calendar')),
    blockedActions: z.array(z.enum(['gmail', 'recruiter', 'organization'])),
    note: z.literal('Policy snapshot only; enforcement remains in the Dira account service.'),
  }).safeParse(value);
  if (legacy.success
    && legacy.data.allowedActions.length === 1
    && ['gmail', 'recruiter', 'organization'].every((item) => legacy.data.blockedActions.includes(item as 'gmail' | 'recruiter' | 'organization'))) {
    return structuredClone(DEFAULT_ACCOUNT_POLICY);
  }
  throw current.error;
}

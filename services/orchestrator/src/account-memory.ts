import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { minutesToIso, type DomainState } from '@dira/commitment-model';
import type { AvailabilityProfile } from './account-planning.js';

const execFile = promisify(execFileCallback);
const repositoryRoot = process.env.DIRA_MEMORY_ROOT ?? '.dira-memory';
const locks = new Map<string, Promise<unknown>>();

function accountDirectory(accountId: string): string {
  const key = createHash('sha256').update(accountId).digest('hex');
  return join(repositoryRoot, key);
}

async function git(directory: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', ['-C', directory, ...args], { maxBuffer: 1024 * 1024 * 8 });
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
  state: DomainState,
  profile: AvailabilityProfile | undefined,
): Promise<{ commit: string; changed: boolean }> {
  const directory = accountDirectory(accountId);
  return withAccountLock(directory, async () => {
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
    };
    const availability = {
      schemaVersion: 1,
      timezone: state.timezone ?? 'UTC',
      profile: profile ?? null,
      focusWindows: state.availability,
    };
    const policy = {
      schemaVersion: 1,
      autonomy: 'approval-required',
      allowedActions: ['google-calendar'],
      blockedActions: ['gmail', 'recruiter', 'organization'],
      note: 'Policy snapshot only; enforcement remains in the Dira account service.',
    };
    await Promise.all([
      writePrivateFile(join(directory, 'graph.json'), `${JSON.stringify(graph, null, 2)}\n`),
      writePrivateFile(join(directory, 'availability.json'), `${JSON.stringify(availability, null, 2)}\n`),
      writePrivateFile(join(directory, 'policy.json'), `${JSON.stringify(policy, null, 2)}\n`),
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

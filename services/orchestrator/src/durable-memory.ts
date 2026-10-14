import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { PoolClient } from 'pg';
import type { PostgresAccountStore } from './postgres-store.js';
import { decryptAccountSecret, encryptAccountSecret } from './google-auth.js';

const execFile = promisify(execFileCallback);
let store: PostgresAccountStore | undefined;
export function configureDurableMemoryStore(value: PostgresAccountStore): void { store = value; }
function enabled(): boolean { return process.env.DIRA_MEMORY_BACKEND === 'postgres'; }

async function saveBundle(client: PoolClient, accountId: string, directory: string, temporary: string): Promise<void> {
  const bundlePath = join(temporary, 'memory.bundle');
  const { stdout } = await execFile('git', ['-C', directory, 'rev-parse', 'HEAD']);
  await execFile('git', ['-C', directory, 'bundle', 'create', bundlePath, '--all']);
  const bundle = await readFile(bundlePath);
  if (bundle.length > 25 * 1024 * 1024) throw new Error('Private memory exceeds the 25 MiB bundle limit.');
  const encrypted = encryptAccountSecret({ bundle: bundle.toString('base64') });
  await client.query(
    `INSERT INTO dira_memory_bundles(account_id, commit_sha, ciphertext, iv, auth_tag, key_version)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(account_id) DO UPDATE SET
       commit_sha=EXCLUDED.commit_sha, ciphertext=EXCLUDED.ciphertext,
       iv=EXCLUDED.iv, auth_tag=EXCLUDED.auth_tag, key_version=EXCLUDED.key_version, updated_at=now()`,
    [accountId, stdout.trim(), encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion],
  );
}

/** A cross-process lock protects restore -> Git operation -> durable save. */
export async function withDurableMemory<T>(
  accountId: string, directory: string, action: () => Promise<T>,
  options: { restore?: boolean; remove?: boolean } = {},
): Promise<T> {
  if (!enabled()) return action();
  if (!store) throw new Error('Durable memory storage has not been initialized.');
  return store.withAccount(accountId, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`private-memory:${accountId}`]);
    const temporary = await mkdtemp(join(tmpdir(), 'dira-durable-memory-'));
    await chmod(temporary, 0o700);
    try {
      if (options.restore !== false && !options.remove) {
        const result = await client.query<{
          ciphertext: string; iv: string; auth_tag: string; key_version: number; commit_sha: string;
        }>('SELECT ciphertext, iv, auth_tag, key_version, commit_sha FROM dira_memory_bundles WHERE account_id=$1', [accountId]);
        await rm(directory, { recursive: true, force: true });
        if (result.rows[0]) {
          const row = result.rows[0];
          const decrypted = decryptAccountSecret<{ bundle: string }>({
            ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyVersion: row.key_version, scopes: [],
          });
          const bundle = Buffer.from(decrypted.bundle, 'base64');
          if (bundle.length > 25 * 1024 * 1024) throw new Error('Stored memory bundle exceeds its limit.');
          const path = join(temporary, 'restore.bundle');
          await writeFile(path, bundle, { mode: 0o600 });
          await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
          await execFile('git', ['clone', '--quiet', '--no-hardlinks', path, directory]);
          await chmod(directory, 0o700);
          const { stdout } = await execFile('git', ['-C', directory, 'rev-parse', 'HEAD']);
          if (stdout.trim() !== row.commit_sha) throw new Error('Stored memory commit does not match the restored repository.');
          await execFile('git', ['-C', directory, 'config', 'user.name', 'Dira']);
          await execFile('git', ['-C', directory, 'config', 'user.email', 'dira-memory@localhost']);
        }
      }
      const result = await action();
      if (options.remove) await client.query('DELETE FROM dira_memory_bundles WHERE account_id=$1', [accountId]);
      else await saveBundle(client, accountId, directory, temporary);
      return result;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}

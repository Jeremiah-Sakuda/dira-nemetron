import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { PostgresAccountStore } from '../services/orchestrator/src/postgres-store.js';
import { configureDurableMemoryStore } from '../services/orchestrator/src/durable-memory.js';
import { exportAccountMemory, persistExistingAccountMemory } from '../services/orchestrator/src/account-memory.js';

// Run only against the replacement application database after its account
// rows have been restored. The account manifest is private, never a model input.
const manifestPath = process.env.DIRA_MIGRATION_ACCOUNT_IDS_FILE;
if (!manifestPath || process.env.DIRA_MEMORY_BACKEND !== 'postgres') {
  throw new Error('Configure a private account manifest and PostgreSQL memory storage.');
}
const ids = z.array(z.string().min(1).max(256)).parse(JSON.parse(await readFile(manifestPath, 'utf8')));
const store = new PostgresAccountStore();
await store.initialize();
configureDurableMemoryStore(store);
let migrated = 0;
try {
  for (const id of new Set(ids)) {
    if (!await store.getAccount(id)) throw new Error('Migration manifest references an account absent from the restored database.');
    await persistExistingAccountMemory(id);
    // Export reads the persisted archive back and verifies its Git commit.
    await exportAccountMemory(id);
    migrated++;
  }
  console.log(JSON.stringify({ migrated, verified: migrated }));
} finally {
  await store.close();
}

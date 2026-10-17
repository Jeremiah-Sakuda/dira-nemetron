import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresAccountStore } from '../../services/orchestrator/src/postgres-store.js';

const url = process.env.DIRA_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('deadline feed listing', () => {
  let store: PostgresAccountStore;
  const accountId = `ical-list-${randomUUID()}`;
  const otherId = `ical-list-${randomUUID()}`;
  const feedId = `feed-${randomUUID()}`;
  beforeAll(async () => {
    store = new PostgresAccountStore(new Pool({ connectionString: url, max: 2 }));
    await store.initialize();
    for (const id of [accountId, otherId]) {
      await store.saveAccount({ accountId: id, email: `${id}@example.com`, timezone: 'UTC' });
    }
  });
  afterAll(async () => {
    for (const id of [accountId, otherId]) await store.withAccount(id, client =>
      client.query('DELETE FROM dira_accounts WHERE account_id=$1', [id]));
    await store.close();
  });
  it('returns an empty list before any feed is connected', async () => {
    expect(await store.listIcalFeeds(accountId)).toEqual([]);
  });
  it('counts top-level event snapshots without exposing encrypted connection data', async () => {
    await store.createIcalFeed(accountId, {
      feedId, label: 'Synthetic deadlines', domain: 'academic',
      urlSecret: { ciphertext: 'synthetic', iv: 'synthetic', authTag: 'synthetic', keyVersion: 1, scopes: [] },
    });
    expect((await store.listIcalFeeds(accountId))[0]?.eventCount).toBe(0);
    const event = { uid: 'synthetic', title: 'Synthetic deadline', startIso: '2026-10-20T12:00:00Z', endIso: '2026-10-20T13:00:00Z', version: '1' };
    await store.saveIcalFeedSync(accountId, feedId, { snapshot: { one: event, two: event } });
    const feeds = await store.listIcalFeeds(accountId);
    expect(feeds).toHaveLength(1);
    expect(feeds[0]?.eventCount).toBe(2);
    expect(feeds[0]).not.toHaveProperty('urlSecret');
    expect(feeds[0]).not.toHaveProperty('snapshot');
  });
  it('keeps another account’s feeds out of the list', async () => {
    expect(await store.listIcalFeeds(otherId)).toEqual([]);
  });
});

-- Action identity, not a process-local array position, is the durable key.
-- This lets independent ledger snapshots upsert records without deleting or
-- replacing unrelated actions from the same account.
ALTER TABLE dira_action_ledger DROP CONSTRAINT IF EXISTS dira_action_ledger_pkey;
ALTER TABLE dira_action_ledger DROP CONSTRAINT IF EXISTS dira_action_ledger_account_id_action_id_key;
ALTER TABLE dira_action_ledger ADD CONSTRAINT dira_action_ledger_pkey PRIMARY KEY (account_id, action_id);

CREATE INDEX IF NOT EXISTS dira_action_ledger_order_idx
  ON dira_action_ledger(account_id, record_index, action_id);

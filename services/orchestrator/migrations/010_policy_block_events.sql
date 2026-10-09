CREATE TABLE IF NOT EXISTS dira_policy_block_events (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  event_id text NOT NULL,
  action_type text NOT NULL,
  target_id text NOT NULL,
  policy_rule text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, event_id),
  CHECK (length(action_type) BETWEEN 1 AND 80),
  CHECK (length(target_id) BETWEEN 1 AND 256),
  CHECK (length(policy_rule) BETWEEN 1 AND 120),
  CHECK (length(reason) BETWEEN 1 AND 500)
);

ALTER TABLE dira_policy_block_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dira_policy_block_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dira_account_isolation ON dira_policy_block_events;
CREATE POLICY dira_account_isolation ON dira_policy_block_events
  USING (account_id = current_setting('dira.account_id', true))
  WITH CHECK (account_id = current_setting('dira.account_id', true));

CREATE TABLE IF NOT EXISTS dira_account_policy_settings (
  account_id text PRIMARY KEY REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  policy jsonb NOT NULL DEFAULT '{"schemaVersion":1,"fencedCalendarIds":[],"requireApproval":[]}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(policy) = 'object')
);

ALTER TABLE dira_account_policy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE dira_account_policy_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dira_account_isolation ON dira_account_policy_settings;
CREATE POLICY dira_account_isolation ON dira_account_policy_settings
  USING (account_id = current_setting('dira.account_id', true))
  WITH CHECK (account_id = current_setting('dira.account_id', true));

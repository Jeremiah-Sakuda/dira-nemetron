CREATE TABLE IF NOT EXISTS dira_availability_profiles (
  account_id text PRIMARY KEY REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  profile jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dira_availability_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE dira_availability_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dira_account_isolation ON dira_availability_profiles;
CREATE POLICY dira_account_isolation ON dira_availability_profiles
  USING (account_id = current_setting('dira.account_id', true))
  WITH CHECK (account_id = current_setting('dira.account_id', true));

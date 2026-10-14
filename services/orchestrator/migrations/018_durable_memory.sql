-- Encrypted private Git bundles survive serverless instance replacement.
CREATE TABLE IF NOT EXISTS dira_memory_bundles (
  account_id text PRIMARY KEY REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  commit_sha text NOT NULL,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  key_version integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE dira_memory_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE dira_memory_bundles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dira_account_isolation ON dira_memory_bundles;
CREATE POLICY dira_account_isolation ON dira_memory_bundles
USING (account_id = current_setting('dira.account_id', true))
WITH CHECK (account_id = current_setting('dira.account_id', true));

CREATE TABLE IF NOT EXISTS dira_credentials (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  provider text NOT NULL,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  key_version integer NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, provider)
);

ALTER TABLE dira_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE dira_credentials FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dira_account_isolation ON dira_credentials;
CREATE POLICY dira_account_isolation ON dira_credentials
  USING (account_id = current_setting('dira.account_id', true))
  WITH CHECK (account_id = current_setting('dira.account_id', true));

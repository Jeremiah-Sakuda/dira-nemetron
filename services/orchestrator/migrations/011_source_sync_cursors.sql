CREATE TABLE IF NOT EXISTS dira_source_sync_cursors (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('google-calendar', 'gmail')),
  cursor text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, source)
);

ALTER TABLE dira_source_sync_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE dira_source_sync_cursors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dira_account_isolation ON dira_source_sync_cursors;
CREATE POLICY dira_account_isolation ON dira_source_sync_cursors
  USING (account_id = current_setting('dira.account_id', true))
  WITH CHECK (account_id = current_setting('dira.account_id', true));

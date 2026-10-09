CREATE TABLE IF NOT EXISTS dira_action_approvals (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  action_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  actor_account_id text NOT NULL CHECK (actor_account_id = account_id),
  source text NOT NULL CHECK (source = 'authenticated-web'),
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, action_id)
);

CREATE INDEX IF NOT EXISTS dira_action_approvals_decided_at_idx
  ON dira_action_approvals(account_id, decided_at DESC);

ALTER TABLE dira_action_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE dira_action_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dira_account_isolation ON dira_action_approvals;
CREATE POLICY dira_account_isolation ON dira_action_approvals
  USING (account_id = current_setting('dira.account_id', true))
  WITH CHECK (account_id = current_setting('dira.account_id', true));

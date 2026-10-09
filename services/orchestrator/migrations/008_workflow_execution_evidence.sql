CREATE TABLE IF NOT EXISTS dira_workflow_execution_evidence (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  workflow_id text NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, workflow_id)
);

ALTER TABLE dira_workflow_execution_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE dira_workflow_execution_evidence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dira_account_isolation ON dira_workflow_execution_evidence;
CREATE POLICY dira_account_isolation ON dira_workflow_execution_evidence
  USING (account_id = current_setting('dira.account_id', true))
  WITH CHECK (account_id = current_setting('dira.account_id', true));

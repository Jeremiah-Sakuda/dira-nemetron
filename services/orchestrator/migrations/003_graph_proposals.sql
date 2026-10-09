CREATE TABLE IF NOT EXISTS dira_graph_proposals (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  proposal_id text NOT NULL,
  source_id text NOT NULL,
  source_type text NOT NULL,
  status text NOT NULL,
  source_snapshot jsonb NOT NULL,
  draft jsonb NOT NULL,
  model_telemetry jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  PRIMARY KEY (account_id, proposal_id),
  UNIQUE (account_id, source_id)
);

ALTER TABLE dira_graph_proposals DROP CONSTRAINT IF EXISTS dira_graph_proposals_status_check;
ALTER TABLE dira_graph_proposals ADD CONSTRAINT dira_graph_proposals_status_check
  CHECK (status IN ('PENDING_REVIEW', 'CONFIRMED', 'REJECTED', 'IGNORED'));

ALTER TABLE dira_graph_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE dira_graph_proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dira_account_isolation ON dira_graph_proposals;
CREATE POLICY dira_account_isolation ON dira_graph_proposals
  USING (account_id = current_setting('dira.account_id', true))
  WITH CHECK (account_id = current_setting('dira.account_id', true));

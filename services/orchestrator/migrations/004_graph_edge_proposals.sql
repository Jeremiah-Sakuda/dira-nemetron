CREATE TABLE IF NOT EXISTS dira_graph_edge_proposals (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  proposal_id text NOT NULL,
  from_commitment_id text NOT NULL,
  to_commitment_id text NOT NULL,
  edge_type text NOT NULL CHECK (edge_type IN (
    'DEPENDS_ON', 'REQUIRES_PREPARATION', 'REQUIRES_BUFFER', 'CONFLICTS_WITH',
    'BLOCKED_BY', 'MUST_PRECEDE', 'MUST_FOLLOW', 'SHARES_RESOURCE_WITH'
  )),
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reason text NOT NULL,
  edge_data jsonb,
  model_telemetry jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING_REVIEW', 'CONFIRMED', 'REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  PRIMARY KEY (account_id, proposal_id),
  UNIQUE (account_id, from_commitment_id, to_commitment_id, edge_type)
);

ALTER TABLE dira_graph_edge_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE dira_graph_edge_proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dira_account_isolation ON dira_graph_edge_proposals;
CREATE POLICY dira_account_isolation ON dira_graph_edge_proposals
  USING (account_id = current_setting('dira.account_id', true))
  WITH CHECK (account_id = current_setting('dira.account_id', true));

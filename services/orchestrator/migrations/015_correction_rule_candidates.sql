-- Candidate rules captured from owner edits and rejections. A candidate never
-- affects planning; only confirmed rules (stored in account policy settings
-- and the memory repo) do.
CREATE TABLE IF NOT EXISTS dira_rule_candidates (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  candidate_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('CANDIDATE', 'CONFIRMED', 'DISMISSED')),
  rule jsonb NOT NULL,
  source jsonb NOT NULL,
  rule_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  PRIMARY KEY (account_id, candidate_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS dira_rule_candidates_open_key
  ON dira_rule_candidates(account_id, rule_key) WHERE status = 'CANDIDATE';

ALTER TABLE dira_rule_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE dira_rule_candidates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dira_account_isolation ON dira_rule_candidates;
CREATE POLICY dira_account_isolation ON dira_rule_candidates
  USING (account_id = current_setting('dira.account_id', true))
  WITH CHECK (account_id = current_setting('dira.account_id', true));

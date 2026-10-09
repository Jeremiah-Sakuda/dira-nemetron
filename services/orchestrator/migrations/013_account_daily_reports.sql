CREATE TABLE IF NOT EXISTS dira_account_daily_reports (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  local_date date NOT NULL,
  report_type text NOT NULL CHECK (report_type IN ('NIGHTLY_RECOMPUTE', 'MORNING_SUMMARY')),
  report jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, local_date, report_type),
  CHECK (jsonb_typeof(report) = 'object')
);

ALTER TABLE dira_account_daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE dira_account_daily_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dira_account_isolation ON dira_account_daily_reports;
CREATE POLICY dira_account_isolation ON dira_account_daily_reports
  USING (account_id = current_setting('dira.account_id', true))
  WITH CHECK (account_id = current_setting('dira.account_id', true));

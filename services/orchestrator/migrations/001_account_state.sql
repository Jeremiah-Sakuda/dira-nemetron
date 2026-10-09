CREATE TABLE IF NOT EXISTS dira_accounts (
  account_id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dira_account_state (
  account_id text PRIMARY KEY REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dira_workflows (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  workflow_id text NOT NULL,
  run jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, workflow_id)
);

CREATE TABLE IF NOT EXISTS dira_events (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  event_id text NOT NULL,
  status text NOT NULL,
  workflow_id text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL,
  failure text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, event_id)
);

CREATE TABLE IF NOT EXISTS dira_action_ledger (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  record_index integer NOT NULL,
  action_id text NOT NULL,
  workflow_id text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL,
  record jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, record_index),
  UNIQUE (account_id, action_id),
  UNIQUE (account_id, idempotency_key)
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'dira_accounts', 'dira_account_state', 'dira_workflows',
    'dira_events', 'dira_action_ledger'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS dira_account_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY dira_account_isolation ON %I USING (account_id = current_setting(''dira.account_id'', true)) WITH CHECK (account_id = current_setting(''dira.account_id'', true))',
      table_name
    );
  END LOOP;
END
$$;

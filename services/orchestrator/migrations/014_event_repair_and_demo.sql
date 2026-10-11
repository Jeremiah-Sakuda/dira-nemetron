-- Event-driven repair, outbound actions, and the isolated no-OAuth demo persona.

ALTER TABLE dira_accounts ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'google';
ALTER TABLE dira_accounts DROP CONSTRAINT IF EXISTS dira_accounts_kind_check;
ALTER TABLE dira_accounts ADD CONSTRAINT dira_accounts_kind_check CHECK (kind IN ('google', 'demo'));
ALTER TABLE dira_accounts ADD COLUMN IF NOT EXISTS demo_expires_at timestamptz;

-- Approvals may come from an authenticated web action or a nonce-checked
-- Telegram callback. Never from a model or a chat agent.
ALTER TABLE dira_action_approvals DROP CONSTRAINT IF EXISTS dira_action_approvals_source_check;
ALTER TABLE dira_action_approvals ADD CONSTRAINT dira_action_approvals_source_check
  CHECK (source IN ('authenticated-web', 'telegram-callback'));

-- Durable flight record per workflow (the in-memory recorder is mirrored here).
CREATE TABLE IF NOT EXISTS dira_flight_records (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  workflow_id text NOT NULL,
  seq integer NOT NULL,
  recorded_at timestamptz NOT NULL,
  phase text NOT NULL,
  message text NOT NULL,
  data jsonb,
  PRIMARY KEY (account_id, workflow_id, seq)
);
CREATE INDEX IF NOT EXISTS dira_flight_records_recent_idx ON dira_flight_records(account_id, recorded_at DESC);

-- Dira's record of task ownership changes. Internal state, labeled as such;
-- the external effect of a delegation is the verified notification.
CREATE TABLE IF NOT EXISTS dira_delegations (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  task_id text NOT NULL,
  title text NOT NULL,
  owner text NOT NULL,
  due_iso text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, task_id)
);

-- Counterparty bookings made by replying to an offer. They stay
-- AWAITING_COUNTERPARTY until the counterparty confirms.
CREATE TABLE IF NOT EXISTS dira_bookings (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  commitment_id text NOT NULL,
  booking_id text NOT NULL,
  slot_id text NOT NULL,
  start_iso text NOT NULL,
  message_ref text NOT NULL,
  status text NOT NULL CHECK (status IN ('AWAITING_COUNTERPARTY', 'CONFIRMED', 'CANCELLED')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, commitment_id)
);

-- Demo persona: per-session simulated calendar, mailbox, and counterparty slots.
CREATE TABLE IF NOT EXISTS dira_sim_calendar_events (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  event_id text NOT NULL,
  title text NOT NULL,
  start_iso text NOT NULL,
  end_iso text NOT NULL,
  tentative boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, event_id)
);

CREATE TABLE IF NOT EXISTS dira_sim_messages (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  message_id text NOT NULL,
  thread_id text NOT NULL,
  folder text NOT NULL CHECK (folder IN ('INBOX', 'SENT', 'DRAFTS')),
  from_address text NOT NULL,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, message_id)
);

CREATE TABLE IF NOT EXISTS dira_sim_slots (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  commitment_id text NOT NULL,
  slot_id text NOT NULL,
  start_iso text NOT NULL,
  end_iso text NOT NULL,
  actually_available boolean NOT NULL,
  booked boolean NOT NULL DEFAULT false,
  PRIMARY KEY (account_id, commitment_id, slot_id)
);

-- Blocked outbound network attempts (application egress guard). OpenShell's
-- proxy enforces the same allowlist at the sandbox boundary in deployment.
CREATE TABLE IF NOT EXISTS dira_egress_audit (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  event_id text NOT NULL,
  host text NOT NULL,
  url text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('DENIED', 'ALLOWED')),
  status_code integer NOT NULL,
  purpose text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, event_id)
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'dira_flight_records', 'dira_delegations', 'dira_bookings',
    'dira_sim_calendar_events', 'dira_sim_messages', 'dira_sim_slots', 'dira_egress_audit'
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

-- Enumerates demo sessions for expiry cleanup. Holds no personal data, so it
-- is not tenant-scoped; every delete then runs inside the account's own RLS context.
CREATE TABLE IF NOT EXISTS dira_demo_sessions (
  account_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

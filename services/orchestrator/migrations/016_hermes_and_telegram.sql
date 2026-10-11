-- Hermes (via NemoClaw) reaches Dira's read-and-report MCP server with a
-- per-account bearer token. Only the SHA-256 of the token is stored. This
-- lookup table maps a token to its account before any tenant context exists.
CREATE TABLE IF NOT EXISTS dira_hermes_tokens (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS dira_hermes_tokens_account_idx ON dira_hermes_tokens(account_id);

-- Telegram approvals. A chat is linked with a one-time code the signed-in
-- owner generates; buttons carry single-use nonces bound to one action, one
-- decision and one chat. Routing tables hold ids only.
CREATE TABLE IF NOT EXISTS dira_telegram_link_codes (
  code_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS dira_telegram_links (
  account_id text PRIMARY KEY REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  chat_id text NOT NULL UNIQUE,
  linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dira_telegram_nonces (
  nonce_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  chat_id text NOT NULL,
  action_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

-- Changes the owner relayed through chat. They wait for an authenticated
-- confirmation before entering the repair engine.
CREATE TABLE IF NOT EXISTS dira_user_notes (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  note_id text NOT NULL,
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 1000),
  source text NOT NULL CHECK (source IN ('hermes', 'web')),
  status text NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'DISCARDED')),
  workflow_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, note_id)
);
ALTER TABLE dira_user_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dira_user_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dira_account_isolation ON dira_user_notes;
CREATE POLICY dira_account_isolation ON dira_user_notes
  USING (account_id = current_setting('dira.account_id', true))
  WITH CHECK (account_id = current_setting('dira.account_id', true));

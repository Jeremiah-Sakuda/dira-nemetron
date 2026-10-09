CREATE TABLE IF NOT EXISTS dira_ical_feeds (
  account_id text NOT NULL REFERENCES dira_accounts(account_id) ON DELETE CASCADE,
  feed_id text NOT NULL,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  domain text NOT NULL CHECK (domain IN ('academic', 'career')),
  enabled boolean NOT NULL DEFAULT true,
  auto_sync boolean NOT NULL DEFAULT false,
  url_ciphertext text NOT NULL,
  url_iv text NOT NULL,
  url_auth_tag text NOT NULL,
  url_key_version integer NOT NULL,
  etag text,
  last_modified text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, feed_id),
  CHECK (jsonb_typeof(snapshot) = 'object')
);

ALTER TABLE dira_ical_feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE dira_ical_feeds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dira_account_isolation ON dira_ical_feeds;
CREATE POLICY dira_account_isolation ON dira_ical_feeds
  USING (account_id = current_setting('dira.account_id', true))
  WITH CHECK (account_id = current_setting('dira.account_id', true));

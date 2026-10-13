-- Deployment-wide quota and non-content telemetry. This table contains no
-- account identifiers, prompts, source contents, responses, or credentials.
CREATE TABLE IF NOT EXISTS dira_inference_usage (
  request_id UUID PRIMARY KEY,
  scope TEXT NOT NULL,
  model TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('nano', 'super', 'ultra')),
  request_bytes INTEGER NOT NULL CHECK (request_bytes > 0),
  max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens > 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'completed', 'failed')),
  http_status INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER,
  estimated_cost_usd NUMERIC(16, 8)
);
CREATE INDEX IF NOT EXISTS dira_inference_usage_scope_time ON dira_inference_usage (scope, started_at);

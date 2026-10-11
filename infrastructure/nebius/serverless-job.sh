#!/usr/bin/env bash
# Run the 02:00 recompute / 07:00 summary pass as a Nebius Serverless AI Job
# instead of the in-process scheduler. Docs:
#   https://docs.nebius.com/cli/reference/ai/job/create.md
# The Jobs CLI has no schedule flag, so the VM's cron launches this script
# hourly; the pass itself is idempotent per account and local date.
set -euo pipefail
: "${DIRA_JOB_IMAGE:?registry path of the orchestrator image}"
: "${NEBIUS_SUBNET_ID:?}"
: "${DATABASE_URL_SECRET:?mysterybox selector for DATABASE_URL}"
nebius ai job create \
  --name "dira-daily-$(date -u +%Y%m%d%H)" \
  --image "$DIRA_JOB_IMAGE" \
  --container-command node_modules/.bin/tsx --args scripts/daily-job.ts \
  --platform cpu-d3 --preset 2vcpu-8gb \
  --timeout 1h --restart-policy never \
  --subnet-id "$NEBIUS_SUBNET_ID" \
  --env "DIRA_DAILY_JOB_ACCOUNT_IDS=${DIRA_DAILY_JOB_ACCOUNT_IDS:-}" \
  --env-secret "DATABASE_URL=${DATABASE_URL_SECRET}"

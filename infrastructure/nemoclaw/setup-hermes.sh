#!/usr/bin/env bash
# Create one account's Hermes sandbox with NemoClaw and connect it to Dira.
# Usage: DIRA_HERMES_TOKEN=... NEBIUS_API_KEY=... ./setup-hermes.sh <account-slug>
#
# Docs: https://docs.nvidia.com/nemoclaw/latest/get-started/quickstart-hermes.html
#       https://docs.nvidia.com/nemoclaw/user-guide/hermes/manage-sandboxes/mcp-servers/add-an-mcp-server.md
# Hermes support in NemoClaw is marked experimental by NVIDIA; check the
# current docs before running. Variable names for the custom inference
# provider below follow those docs and should be confirmed for your version.
set -euo pipefail
ACCOUNT="${1:?account slug}"
SANDBOX="dira-hermes-${ACCOUNT}"
: "${DIRA_HERMES_TOKEN:?create one in Dira Settings → Telegram and Hermes}"
: "${NEBIUS_API_KEY:?}"
: "${DIRA_API_DOMAIN:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if ! command -v nemohermes >/dev/null; then
  curl -fsSL https://www.nvidia.com/nemoclaw.sh | \
    NEMOCLAW_AGENT=hermes NEMOCLAW_SANDBOX_NAME="$SANDBOX" NEMOCLAW_NON_INTERACTIVE=1 \
    NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1 bash -s -- --defer-onboarding
fi

# Inference: Nemotron Super through Nebius Token Factory's OpenAI-compatible API.
NEMOCLAW_PROVIDER=custom \
NEMOCLAW_ENDPOINT_URL="https://api.tokenfactory.nebius.com" \
NEMOCLAW_MODEL="nvidia/nemotron-3-super-120b-a12b" \
COMPATIBLE_API_KEY="$NEBIUS_API_KEY" \
  nemohermes onboard

# Network policy: default deny plus Dira's MCP host and Telegram only.
envsubst < "$HERE/../openshell/hermes-sandbox-policy.yaml" > "/tmp/${SANDBOX}-policy.yaml"
openshell policy set "$SANDBOX" --policy "/tmp/${SANDBOX}-policy.yaml" --wait

# Dira as a read-and-report MCP server (Streamable HTTP over HTTPS only).
export DIRA_HERMES_TOKEN
nemohermes "$SANDBOX" mcp add dira --url "https://${DIRA_API_DOMAIN}/mcp" --env DIRA_HERMES_TOKEN

# Chat channel for the owner (TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_IDS in env).
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  nemohermes "$SANDBOX" channels add telegram
fi

echo "Sandbox $SANDBOX ready. Mirror confirmed rules with: ./sync-skills.sh $ACCOUNT <memory-repo-dir>"

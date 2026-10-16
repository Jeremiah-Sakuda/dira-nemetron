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
[[ "$ACCOUNT" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]] || { echo 'Use a lowercase account slug (up to 40 characters).' >&2; exit 1; }
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
export PATH="$HOME/.local/bin:$PATH"
command -v nemohermes >/dev/null
command -v openshell >/dev/null

if nemohermes "$SANDBOX" status --json >/dev/null 2>&1; then
  echo "Sandbox $SANDBOX already exists. Inspect its live policy and use managed MCP commands; this setup is for a new sandbox." >&2
  exit 1
fi

# Inference: Nemotron Super through Nebius Token Factory's OpenAI-compatible API.
NEMOCLAW_PROVIDER=custom \
NEMOCLAW_ENDPOINT_URL="https://api.tokenfactory.nebius.com/v1" \
NEMOCLAW_MODEL="nvidia/nemotron-3-super-120b-a12b" \
NEMOCLAW_NON_INTERACTIVE=1 NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1 \
NEMOCLAW_POLICY_TIER=restricted NEMOCLAW_POLICY_MODE=suggested \
COMPATIBLE_API_KEY="$NEBIUS_API_KEY" \
  nemohermes onboard --non-interactive --name "$SANDBOX"

# Preserve generated runtime rules; narrow auxiliary egress before managed MCP.
POLICY_DIR="$(mktemp -d)"
trap 'rm -rf "$POLICY_DIR"' EXIT
openshell policy get "$SANDBOX" --base -o json > "$POLICY_DIR/base.json"
python3 "$HERE/../openshell/restrict-network.py" "$POLICY_DIR/base.json" > "$POLICY_DIR/restricted.yaml"
openshell policy set "$SANDBOX" --policy "$POLICY_DIR/restricted.yaml" --wait

# Dira as a read-and-report MCP server (Streamable HTTP over HTTPS only).
export DIRA_HERMES_TOKEN
nemohermes "$SANDBOX" mcp add dira --url "https://${DIRA_API_DOMAIN}/mcp" --env DIRA_HERMES_TOKEN \
  --deny-tool dira_approve --deny-tool dira_send

# Chat channel for the owner (TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_IDS in env).
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  nemohermes "$SANDBOX" channels add telegram
fi

echo "Sandbox $SANDBOX ready. Mirror confirmed rules with: ./sync-skills.sh $ACCOUNT <memory-repo-dir>"

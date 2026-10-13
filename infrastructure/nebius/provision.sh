#!/usr/bin/env bash
# Create the always-on Nebius CPU VM that runs Postgres, the Dira broker,
# the web app, the scheduler and the NemoClaw/OpenShell gateway.
# Docs: https://docs.nebius.com/compute/virtual-machines/create.md
set -euo pipefail
: "${NEBIUS_SUBNET_ID:?nebius vpc subnet list}"
NAME="${DIRA_VM_NAME:-dira-prod}"
PLATFORM="${DIRA_VM_RESOURCES_PLATFORM:-cpu-d3}"
PRESET="${DIRA_VM_RESOURCES_PRESET:-2vcpu-8gb}"
SSH_PUBLIC_KEY="${DIRA_SSH_PUBLIC_KEY:-}"
if [[ -z "$SSH_PUBLIC_KEY" ]]; then
  SSH_PUBLIC_KEY_FILE="${DIRA_SSH_PUBLIC_KEY_FILE:-${HOME}/.ssh/id_ed25519.pub}"
  [[ -r "$SSH_PUBLIC_KEY_FILE" ]] || { echo "SSH public key not readable: $SSH_PUBLIC_KEY_FILE" >&2; exit 1; }
  SSH_PUBLIC_KEY="$(<"$SSH_PUBLIC_KEY_FILE")"
fi
USER_DATA="$(python3 - "$(dirname "$0")/cloud-init.yaml" "$SSH_PUBLIC_KEY" <<'PY'
import json
import pathlib
import sys

path, key = sys.argv[1:]
if not key.startswith(("ssh-ed25519 ", "ssh-rsa ", "ecdsa-sha2-")):
    raise SystemExit("DIRA_SSH_PUBLIC_KEY is not a supported SSH public key")
template = pathlib.Path(path).read_text()
print(template.replace("__DIRA_SSH_AUTHORIZED_KEY__", json.dumps(key)), end="")
PY
)"
nebius compute instance create \
  --name "$NAME" \
  --resources-platform "$PLATFORM" --resources-preset "$PRESET" \
  --boot-disk-managed-disk-name "${NAME}-boot" \
  --boot-disk-managed-disk-type network_ssd \
  --boot-disk-managed-disk-source-image-family-image-family ubuntu24.04-driverless \
  --boot-disk-managed-disk-size-gibibytes 80 \
  --boot-disk-attach-mode read_write \
  --network-interfaces "[{\"name\":\"eth0\",\"ip_address\":{},\"public_ip_address\":{},\"subnet_id\":\"${NEBIUS_SUBNET_ID}\"}]" \
  --cloud-init-user-data "$USER_DATA"
echo "VM requested. Point DNS for the web and API domains at its public IP, then copy dira.env and run deploy.sh on the VM."

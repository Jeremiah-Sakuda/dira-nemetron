#!/usr/bin/env bash
# Create the always-on Nebius CPU VM that runs Postgres, the Dira broker,
# the web app, the scheduler and the NemoClaw/OpenShell gateway.
# Docs: https://docs.nebius.com/compute/virtual-machines/create.md
set -euo pipefail
: "${NEBIUS_SUBNET_ID:?nebius vpc subnet list}"
NAME="${DIRA_VM_NAME:-dira-prod}"
USER_DATA="$(cat "$(dirname "$0")/cloud-init.yaml")"
nebius compute instance create \
  --name "$NAME" \
  --resources-platform cpu-d3 --resources-preset 4vcpu-16gb \
  --boot-disk-managed-disk-name "${NAME}-boot" \
  --boot-disk-managed-disk-source-image-family-image-family ubuntu24.04-driverless \
  --boot-disk-managed-disk-size-gibibytes 80 \
  --network-interfaces "[{\"name\":\"eth0\",\"ip_address\":{},\"public_ip_address\":{},\"subnet_id\":\"${NEBIUS_SUBNET_ID}\"}]" \
  --cloud-init-user-data "$USER_DATA"
echo "VM requested. Point DNS for the web and API domains at its public IP, then copy dira.env and run deploy.sh on the VM."

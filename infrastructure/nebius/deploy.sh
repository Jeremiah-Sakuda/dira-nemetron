#!/usr/bin/env bash
# On the VM: pull the pinned release and (re)start the stack with TLS.
# Usage: ./deploy.sh [git-ref]   (judges' deployment pins a release tag)
set -euo pipefail
cd "$(dirname "$0")/../.."
REF="${1:-main}"
git fetch --tags origin && git checkout --quiet "$REF"
cd infrastructure/nebius
[ -f dira.env ] || { echo "dira.env is missing (copy dira.env.example)"; exit 1; }
chmod 600 dira.env
docker compose --env-file dira.env --profile tls up -d --build
docker compose --env-file dira.env ps
curl -fsS "http://127.0.0.1:${DIRA_ORCHESTRATOR_HOST_PORT:-8081}/health"

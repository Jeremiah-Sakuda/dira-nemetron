#!/usr/bin/env bash
# On the VM: pull the pinned release and (re)start the stack with TLS.
# Usage: ./deploy.sh [git-ref]   (judges' deployment pins a release tag)
set -euo pipefail
cd "$(dirname "$0")/../.."
REF="${1:-main}"
REMOTE=v2
if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then REMOTE=origin; fi
case "$(git remote get-url "$REMOTE")" in
  https://github.com/Jeremiah-Sakuda/dira-nemetron.git|git@github.com:Jeremiah-Sakuda/dira-nemetron.git) ;;
  *) echo 'Refusing deployment: remote must be Jeremiah-Sakuda/dira-nemetron.' >&2; exit 1 ;;
esac
git fetch --tags "$REMOTE"
if git show-ref --verify --quiet "refs/remotes/$REMOTE/$REF"; then
  REF="$REMOTE/$REF"
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo 'Tracked deployment changes must be saved before selecting a release.' >&2; exit 1
fi
git checkout --quiet --detach "$REF"
cd infrastructure/nebius
[ -f dira.env ] || { echo "dira.env is missing (copy dira.env.example)"; exit 1; }
chmod 600 dira.env
docker compose --env-file dira.env --profile tls up -d --build
docker compose --env-file dira.env ps
health_url="http://127.0.0.1:${DIRA_ORCHESTRATOR_HOST_PORT:-8081}/health"
for attempt in {1..30}; do
  if curl -fsS "$health_url"; then exit 0; fi
  sleep 2
done
echo "Orchestrator health check timed out: $health_url" >&2
exit 1

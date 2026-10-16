#!/usr/bin/env bash
# Host-authoritative Skills mirror for the measured Linux OpenShell Docker driver.
# The operator needs Docker access on the isolated host. Never run this through
# Hermes: its workload cannot write the canonical /opt/hermes read-only tree.
# Usage: ./sync-skills.sh <account-slug> <memory-repo-dir>
set -euo pipefail
ACCOUNT="${1:?account slug}"
[[ "$ACCOUNT" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]] || { echo 'Invalid account slug' >&2; exit 1; }
REPO="${2:?path to the account memory repo}"
SANDBOX="dira-hermes-${ACCOUNT}"
SRC="$REPO/skills/dira"
[ -d "$SRC" ] || { echo 'No confirmed rules yet'; exit 0; }
# Refuse symlinks and special files in the exported Skills tree.
python3 - "$SRC" <<'PY'
import pathlib,sys
root=pathlib.Path(sys.argv[1])
if root.is_symlink(): raise SystemExit('Skills source must not be a symlink')
for p in root.rglob('*'):
 if p.is_symlink() or not(p.is_dir() or p.is_file()):
  raise SystemExit('Skills mirror accepts regular files and directories only.')
PY
# Match the observed default-workspace Docker naming convention. Fail closed
# for other drivers/workspaces or ambiguous/stale containers; never guess one.
CONTAINERS="$(docker ps --filter "name=openshell-default--${SANDBOX}-" --format '{{.ID}}')"
[[ "$CONTAINERS" =~ ^[a-f0-9]{12,64}$ ]] || { echo 'Expected exactly one running sandbox container in the default workspace.' >&2; exit 1; }
CONTAINER="$CONTAINERS"
NAME="$(docker inspect --format '{{.Name}}' "$CONTAINER")"
[[ "$NAME" == "/openshell-default--${SANDBOX}-"* ]] || { echo 'Container identity does not match the sandbox' >&2; exit 1; }
docker exec --user 0 "$CONTAINER" /bin/sh -c 'mkdir -p /opt/hermes/dira-skills-staging; rm -rf /opt/hermes/dira-skills-staging/current'
docker cp "$SRC" "$CONTAINER:/opt/hermes/dira-skills-staging/current"
docker exec --user 0 "$CONTAINER" /bin/sh -c '
  mkdir -p /opt/hermes/skills /sandbox/.hermes/skills
  rm -rf /opt/hermes/skills/dira
  mv /opt/hermes/dira-skills-staging/current /opt/hermes/skills/dira
  chmod -R a+rX /opt/hermes/skills/dira
  rm -rf /sandbox/.hermes/skills/dira
  ln -s /opt/hermes/skills/dira /sandbox/.hermes/skills/dira
'
# Prove the workload can read every Skill and cannot open the canonical files
# for writing. This deliberately uses managed exec, which applies the sandbox.
nemohermes "$SANDBOX" exec --no-tty --timeout 30 -- /opt/hermes/.venv/bin/python -c '
import pathlib,json
root=pathlib.Path("/opt/hermes/skills/dira")
files=list(root.glob("*/SKILL.md"))
if not files: raise SystemExit("No Skill files were mirrored")
for p in files:
 p.read_text()
 try:
  with p.open("a"): pass
 except PermissionError: continue
 raise SystemExit("Skill write protection is not enforced; do not enable this mirror")
print(json.dumps({"readableSkills":len(files),"writeDenied":True}))
'

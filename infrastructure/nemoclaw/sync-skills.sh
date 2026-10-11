#!/usr/bin/env bash
# Mirror an account's confirmed Dira rules into its Hermes sandbox as
# read-only Skills (skills/dira/<rule-id>/SKILL.md from the memory repo).
# Run from the host after each rules change (or from cron).
# NOTE: the `openshell sandbox exec` / `cp` subcommands are written from the
# OpenShell CLI's documented shape but were not run against a live gateway;
# confirm them with `openshell sandbox --help` on your version.
# Usage: ./sync-skills.sh <account-slug> <memory-repo-dir>
set -euo pipefail
ACCOUNT="${1:?account slug}"
REPO="${2:?path to the account's memory repo}"
SANDBOX="dira-hermes-${ACCOUNT}"
SRC="$REPO/skills/dira"
[ -d "$SRC" ] || { echo "no confirmed rules yet"; exit 0; }
# The sandbox policy mounts /sandbox/.hermes/skills/dira read-only for the
# agent; the host copies into it through OpenShell's file transfer.
openshell sandbox exec "$SANDBOX" -- rm -rf /sandbox/.hermes/skills/dira.tmp
openshell sandbox cp "$SRC" "$SANDBOX:/sandbox/.hermes/skills/dira.tmp"
openshell sandbox exec "$SANDBOX" -- sh -c 'rm -rf /sandbox/.hermes/skills/dira && mv /sandbox/.hermes/skills/dira.tmp /sandbox/.hermes/skills/dira'
echo "Synced $(ls "$SRC" | wc -l | tr -d ' ') rule skill(s) into $SANDBOX"

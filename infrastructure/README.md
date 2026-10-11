# Deploying Dira v2 on Nebius

Dira runs on one always-on Nebius CPU VM. The VM hosts four things:

- Postgres, the operational store, with row-level security per account.
- The Dira orchestrator. It is also the action broker and holds every OAuth credential.
- The web app.
- The scheduler and the NemoClaw/OpenShell gateway for per-account Hermes sandboxes.

Model calls go to Nemotron on Nebius Token Factory.

```
 Browser ──HTTPS──▶ Caddy ──▶ web (Next.js) ──server-to-server──▶ orchestrator/broker ──▶ Postgres (RLS)
 Hermes sandbox (OpenShell, default-deny) ──HTTPS /mcp──▶ orchestrator         │
 Telegram ──HTTPS /telegram/webhook (secret header)──▶ orchestrator             ├──▶ Token Factory (Nemotron)
                                                                                ├──▶ Google Calendar / Gmail
                                                                                └──▶ private Git memory repos
```

| Path | What it is |
| --- | --- |
| `nebius/provision.sh`, `nebius/cloud-init.yaml` | Create the VM with the `nebius` CLI (cpu-d3, Ubuntu 24.04) and install Docker. |
| `nebius/docker-compose.yml` | Postgres, orchestrator, web, and Caddy with the `tls` profile. |
| `nebius/postgres-init.sh` | Creates the non-superuser `dira_app` role. Superusers bypass RLS, so the app never connects as one. |
| `nebius/deploy.sh` | Check out a pinned release tag on the VM and start the stack. |
| `nebius/backup.sh` | Nightly `pg_dump` plus the memory repositories, kept for 14 days. |
| `nebius/serverless-job.sh` | Runs the daily recompute and summary pass as a Nebius Serverless AI Job. |
| `openshell/hermes-sandbox-policy.yaml` | Default-deny egress for each Hermes sandbox. Only Dira's MCP host and Telegram are allowed, all `enforce`. |
| `openshell/dira-broker-egress.txt` | The broker's allowlist, also enforced in-process with an audited HTTP 403. |
| `nemoclaw/setup-hermes.sh` | One Hermes sandbox per account with Nebius inference, the Dira MCP server, and Telegram. |
| `nemoclaw/sync-skills.sh` | Mirror confirmed rules (`skills/dira/*/SKILL.md`) into the sandbox, read-only. |

## Steps

1. Run `nebius/provision.sh` with `NEBIUS_SUBNET_ID` set. Point the web and API domains at the VM's public IP.
2. On the VM, copy `nebius/dira.env.example` to `nebius/dira.env`, fill it in, and `chmod 600` it.
3. Run `nebius/deploy.sh v2.0.0`. The judged deployment pins a release tag; the author's own instance runs separately.
4. Register the Telegram webhook with the secret token:
   ```bash
   curl -s "https://api.telegram.org/bot$DIRA_TELEGRAM_BOT_TOKEN/setWebhook" -d "url=https://$DIRA_API_DOMAIN/telegram/webhook" -d "secret_token=$DIRA_TELEGRAM_WEBHOOK_SECRET"
   ```
5. For each account that wants chat, create a Hermes token in Dira Settings, then run `nemoclaw/setup-hermes.sh <account>`.
6. Add trusted account ids to the `DIRA_*_ACCOUNT_IDS` variables to turn on background polling and the daily jobs.

## What is verified and what is not

**Verified locally:** both images build and the stack runs from a clean volume. RLS holds under the `dira_app` role. The demo persona runs end to end: approval pause, a 409 recovered through replanning, and verified surfaces. The egress guard returns 403 with an audit row.

**Not run against live Nebius or NVIDIA services:**

- The `nebius` CLI calls.
- NemoClaw and OpenShell enrollment. NVIDIA marks Hermes support in NemoClaw as experimental, and the custom-provider variable names in `setup-hermes.sh` come from NVIDIA's docs but should be confirmed for your installed version.
- Serverless Jobs. The Jobs CLI has no schedule flag, so the VM cron launches them, and their CPU-only support should be confirmed.

Each command cites the doc it follows.

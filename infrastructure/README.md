# Deploying Dira v2 on Nebius

Dira runs on one always-on Nebius CPU VM. The VM hosts four things:

- Postgres, the operational store, with row-level security per account.
- The Dira orchestrator. It is also the action broker and holds every OAuth credential.
- The web app.
- Caddy for HTTPS. The daily scheduler and per-account NemoClaw/OpenShell sandboxes remain separate deployment work.

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

## Token Factory integration without provisioning a VM

Use Node 22 from the repository root. The following command explicitly loads
`infrastructure/nebius/dira.env` without shell-sourcing it or printing secrets:

```sh
npm run models:check:nebius
```

This reads `/models` and performs no inference. Exported shell variables take
precedence over the env file, following Node's `--env-file` behavior. Keep the
file ignored and mode 0600. Use a **Token Factory API key**, not a Cloud CLI token.
The shared model routing config supplies Nano, Super and Ultra; exact availability
must pass the catalog check for this account.

The owner selected credits-only testing for inference. Catalog success does not
establish credit coverage; check balance, expiry, and automatic top-ups in
[Token Factory billing](https://docs.tokenfactory.nebius.com/other-capabilities/billing)
before additional model calls. The two live evaluations were run on October 12,
2026; the latest October 13 runs and bounded structured output fix are documented in `docs/evidence/2026-10-13-bounded-model-review.md`.

Once credentials and credit coverage are verified, run synthetic-data evaluations:

```sh
npm run eval:nemotron:nebius
npm run eval:repair:nebius
```

The repair evaluation uses local simulated action adapters; it does not send mail
or modify a real calendar. These commands generate evidence artifacts only when
actually run. Review all failures before making quality claims. Model HTTP requests
cap output at 4,096 tokens and serialized request size at 128 KiB by default.
`DIRA_MODEL_MAX_OUTPUT_TOKENS`, `DIRA_MODEL_MAX_REQUEST_BYTES` and
`DIRA_MODEL_MAX_ATTEMPTS` override the bounds (see the example env file).
The request byte cap is not an exact token count. The example uses one HTTP attempt;
the client's fallback default is three. Higher-level schema or planning retries can
make additional calls. These controls are not a total spending cap or credit-balance
check. Truncated/refused/incomplete completions fail closed even if their text parses.

**October 12 checks:** an initial catalog request returned HTTP 401. The final
`npm run models:check:nebius` request succeeded using the deployment env file
(with no shell API-key override), and all three configured model IDs were present.
The live interpretation run passed 7/8 checks; the repair run resolved six of
seven scenarios, with incomplete Ultra responses in five calls. See the evidence
review for details. TypeScript and 92 tests passed; nine Postgres-dependent tests
were skipped. Eleven new client tests cover limits, incomplete responses,
authentication errors, bounded retries, HTTPS and Ultra routing. No cloud
provisioning was performed. On October 13 the Nebius console showed a $25 account
balance; automatic top-up status has not been verified. At the console estimate,
$25 covers roughly 312 hours of runtime; set a maximum uptime before leaving the VM on.

## VM deployment and billing

The provisioning default is `cpu-d3` with 2 vCPUs and 8 GiB RAM. On October 13,
2026, the Nebius Console estimated the regular VM plus the selected 80-GiB boot
disk at $0.08/hour ($58.40 per 730-hour month); verify the estimate in the
console before creation. The account balance observed that day was $25, and
automatic top-up status was not verified.

1. Run `nebius/provision.sh` with `NEBIUS_SUBNET_ID` set and an SSH public key at `~/.ssh/id_ed25519.pub` (or set `DIRA_SSH_PUBLIC_KEY_FILE`). The script adds that key to the `dira` account at first boot. Point DNS for the web and API domains at the VM's public IP.
2. On the VM, copy `nebius/dira.env.example` to `nebius/dira.env`, fill it in, and `chmod 600` it.
3. Run `nebius/deploy.sh v2.0.0`. The judged deployment pins a release tag; the author's own instance runs separately.
4. Register the Telegram webhook with the secret token:
   ```bash
   curl -s "https://api.telegram.org/bot$DIRA_TELEGRAM_BOT_TOKEN/setWebhook" -d "url=https://$DIRA_API_DOMAIN/telegram/webhook" -d "secret_token=$DIRA_TELEGRAM_WEBHOOK_SECRET"
   ```
5. For each account that wants chat, create a Hermes token in Dira Settings, then run `nemoclaw/setup-hermes.sh <account>`.
6. Add trusted account ids to the `DIRA_*_ACCOUNT_IDS` variables to turn on background polling and the daily jobs.

## What is verified and what is not

**Verified locally (2026-10-11):**
- Both images build, and the images contain no env files or deployment secrets.
- The services ran from a clean Postgres volume with `docker run` on a private network, using the compose file's images, init script and environment. The build machine has no Compose plugin.
- The init script creates `dira_app` as a non-superuser without `BYPASSRLS`.
- Through the web container: demo start, the cascade to −3.6h, the approval pause, and approval resolving with 13 verified actions and both outbound messages. The booking was held as `AWAITING_COUNTERPARTY`. The egress probe was blocked with 403, and a request with the wrong Origin was refused.

**Not run against live Nebius or NVIDIA services:**

- The `nebius` CLI calls.
- NemoClaw and OpenShell enrollment. NVIDIA marks Hermes support in NemoClaw as experimental, and the custom-provider variable names in `setup-hermes.sh` come from NVIDIA's docs but should be confirmed for your installed version.
- Serverless Jobs. The Jobs CLI has no schedule flag, so the VM cron launches them, and their CPU-only support should be confirmed.

Each command cites the doc it follows.

## Current Nebius demo deployment (October 13, 2026)

- The live VM is `dira-nemetron-demo-access` (`cpu-d3`, 2 vCPU/8 GiB, 80-GiB network SSD) at `213.239.172.39`. It runs Postgres, the orchestrator, web app and Caddy. The original empty VM was replaced after its first-boot config omitted an SSH key; the replacement now receives the local public key through cloud-init.
- Temporary judge URLs: [web demo](https://213-239-172-39.nip.io) and [orchestrator health](https://api.213-239-172-39.nip.io/health). Both returned HTTP 200 with valid TLS from outside the VM. The hostnames use nip.io and the VM's dynamic public IP; use a project-owned domain and static IP for a stable submission URL.
- The live `/try` path was exercised with a synthetic email. The labeled forged-provenance proposal was rejected; policy required approval for delegation; approval revalidated 13 ledger intents; a stale simulated interview slot returned 409 and triggered a replan; 13 actions then passed fresh read-back verification. The result restored global slack from −3.6 hours to +1.3 hours.
- The public egress probe returned audited HTTP 403 for `outside-collector.example`. This verifies the broker's application-level allowlist only. **OpenShell/NemoClaw is not enrolled or running on this VM; network-edge sandbox enforcement is not active or verified.** The UI states this explicitly.
- Live Token Factory inference was enabled on October 13 after the initial stored-interpretation deployment. The API key is present only in the orchestrator's mode-0600 env file; the web container has no model key. The `/try` interface reports `Nemotron live · Nebius Token Factory` and accepts edited synthetic emails. There are no Google OAuth credentials; the demo requires no personal sign-in and uses simulated calendar/mail/broker surfaces. It does not mutate real accounts.
- Each service model HTTP attempt reserves durable Postgres quota: 100 total, 20 in a rolling 24 hours, 12 per hour and 2 concurrently. Failed attempts consume quota. The live configuration requests at most 4,096 output tokens, serializes at most 65,536 request bytes and permits one HTTP attempt. Usage survives demo resets and service restarts, and tokens plus estimated cost are recorded without prompts or credentials. These are deployment call limits, not a provider-enforced spending cap; standalone evals do not use this service quota.
- The public live inference verification made four model calls with 20,855 reported tokens, about $0.036 estimated cost. Super interpreted the exam change; the two incomplete Ultra calls failed closed, and deterministic candidates repaired the synthetic world after authenticated demo-session approval. Thirteen actions passed read-back verification. The live injection email changed no surfaces, the application egress probe returned 403, and credential-free Evidence replay completed without model calls. See [`../docs/evidence/2026-10-13-live-demo-inference-review.md`](../docs/evidence/2026-10-13-live-demo-inference-review.md).
- Compose initially returned from its first health probe before the orchestrator was ready. `deploy.sh` now retries health for up to 60 seconds. The stack subsequently passed local and public health checks.

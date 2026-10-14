# Vercel deployment — October 14, 2026

Public judge URL: https://dira-nemetron.vercel.app/try. Credential-free replay: https://dira-nemetron.vercel.app/evidence.

The new `dira-nemetron` project is on Vercel Hobby and connected only to `Jeremiah-Sakuda/dira-nemetron`, production branch `main`. Its frontend connects to the existing persistent Nebius backend. Production has only the orchestrator URL and web origin variables; no inference, database or OAuth secrets were installed on Vercel.

## Observed checks

- Production homepage, demo, Evidence and policy pages returned 200 without Vercel login. Generated deployment URLs remain protected.
- The Vercel bridge created a signed synthetic session and read persistent account state. Anonymous account state returned 401; untrusted and unconfigured preview mutation origins returned 403. The old judge origin still creates a session. Unmatched backend paths return 404.
- Credential-free deterministic replay returned a complete `done` event.
- A browser-created synthetic session invoked real Super interpretation (1.2 seconds, 1,296 tokens) and Ultra proposal (2.1 seconds, 4,904 tokens), then paused for authenticated approval. Thirteen intents were recorded in the durable ledger before execution.
- Clicking Approve in that session resumed execution. The stale interview slot returned 409; Ultra re-proposed (1.4 seconds, 4,860 tokens). That proposal used invalid provenance and was rejected. Deterministic fallback completed the repair: thirteen simulated actions verified, global slack +246 → −216 → +78 minutes. The observed final flight record had 81 lines.
- The application egress probe returned an audited HTTP 403 for the untrusted host. This is application enforcement, **not** OpenShell validation.
- This browser run consumed three model calls. Deployment-wide usage increased from 15 to 18 attempts; the durable 20-call rolling-day limit remains unchanged.
- Root TypeScript check and the remote Next.js production build succeeded. No additional unit or integration test suite was run for this deployment.

See [structured deployment evidence](2026-10-14-vercel-deployment.json), [approval hold](2026-10-14-vercel-approval-hold.txt), [resolved flight record](2026-10-14-vercel-resolved.txt), and [application egress observation](2026-10-14-vercel-egress.txt). The screenshot shows the resolved repair and fresh reads of explicitly simulated surfaces.

## Changes and limitations

The first Vercel build lacked root workspace TypeScript dependencies; installation now runs from the monorepo root. The initial backend address exposed only health, Hermes and Telegram routes; Caddy now routes account/API authentication paths to the existing service. Signed sessions, exact trusted origins, account isolation, policy, approval and verification remain enforced. The proxy container was recreated to load the changed bind-mounted routing file; Postgres and memory volumes were retained.

`.vercelignore` was added before any source upload. A dry deployment manifest confirmed environment files, private memory and backups were excluded. The CLI's original manifest alone did not honor every Git ignore rule.

The website uses Vercel's free allowance. **The Nebius backend VM and stopped validation VM's storage still cost money.** No upgrade, funds or auto-top-up were added. Cloud Run/database/memory migration remains future work; availability through December 15 is not yet funded or guaranteed. Google OAuth, actual Google mutations and NemoClaw/OpenShell remain unverified.

Configuration and rollback: [Vercel runbook](../../infrastructure/vercel/README.md).

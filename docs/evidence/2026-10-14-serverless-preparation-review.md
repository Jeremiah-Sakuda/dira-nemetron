# Serverless migration preparation — October 14, 2026

**Status: preparation verified; production cutover has not happened.** Vercel still uses the persistent Nebius backend. Do not stop or retire that VM yet.

## Implemented and checked

- Added forced-RLS account storage for encrypted private Git bundles. Per-account database locks serialize restore, update and save across instances; a separate small pool prevents snapshot-read deadlocks. Git history and reusable Skills survive deletion of the local checkout. The existing encryption key must be preserved during migration.
- Added an authenticated scheduled-pass endpoint for host-provisioned and owner-opted-in accounts, with no caller-supplied account/action input. Request-billed deployments suppress startup timers. Daily reports remain durable and idempotent; a daily processing error now makes the scheduled pass fail visibly.
- Added a bootstrap for one backend-only Secret Manager configuration value and a database-role check that rejects superuser/RLS-bypass application credentials.
- Fixed empty-Skills commits and account reset/expiry cleanup. Empty rule sets previously left no `skills` path for Git to stage; the repository now has a constant README. Expiry/reset now clears the local memory checkout as well as database records; encrypted bundle rows cascade with the account.
- Eleven focused PostgreSQL checks passed: six memory/scheduler cases and five existing demo repair/approval/read-back cases. Root TypeScript check passed. Verification used a disposable database and non-superuser role, with synthetic data and no inference calls.

## Actual backup recovery

Private VM backups were taken at **2026-10-14 16:13 UTC**, copied off the VM with mode 0600, and restored in a separate local database. The snapshot had zero retained accounts, ledger records and OAuth credentials, and **18 deployment inference reservations**. It restored 31 public tables and all 18 reservations. The application role has neither superuser nor RLS bypass.

Seven archived private Git repositories passed full Git integrity verification. They are remnants of expired synthetic accounts, not retained database accounts; do not recreate those accounts during migration. The new cleanup fix prevents further orphaned checkouts. Backups and account manifests remain private and are excluded from Git.

The backup restore establishes recovery of this snapshot. It does not establish a Neon production restore, live OAuth recovery, or a completed Cloud Run persistence replacement. Complete the cutover/replacement checks in the [migration runbook](../../infrastructure/serverless/README.md) before retirement.

## Cloud resources prepared

Google Cloud project `dira-prod`: Cloud Run and Artifact Registry APIs enabled; dedicated `dira-nemetron` image repository in `us-east1`; dedicated `dira-nemetron-runtime` service account created. A private staging service boots successfully on native Cloud Run hardware and returns authenticated health 200; anonymous access returns 403. It has one CPU, 512 MiB, maximum one instance, no minimum instances, request CPU billing and no startup CPU boost.

Staging URL: `https://dira-nemetron-backend-683372642422.us-east1.run.app`. It contains **no database/OAuth/inference configuration**, is not the Vercel backend, and cannot demonstrate persistent account operations yet.

The first staging image unnecessarily included frontend dependencies (496,166,531 bytes). It was removed before uploading the reduced runtime image (170,076,603 bytes). Current staging digest: `sha256:87138de6085679822eaa8ef0f558e3532f4e293d6434dbe0a723c16cb6919aab`; it predates the final deletion-cleanup change, so production needs a new image from the published migration source. Local x64 emulation on this Apple Silicon Mac crashed in esbuild; native Cloud Run boot was verified separately. Full production datastore and instance-replacement checks remain pending.

These are free-allowance-oriented settings, not a hard zero-dollar guarantee. Cloud allowances are shared by billing account. No paid Neon plan, VM restart, new funds or auto-top-up was enabled.

## Human and approval prerequisites

- **Neon:** provisioning the explicit `free_v3` plan is blocked by Vercel two-factor login and human acceptance of the Neon marketplace terms. No database has been provisioned.
- **Google:** the owner chose their personal account with synthetic test items. A web OAuth client and the owner's actual consent are still needed. Avoid unrelated inbox/calendar data in verification and public evidence.
- **Sandbox:** the official NVIDIA installer installed NemoHermes CLI v0.0.134 from maintained ref `8a5718dd14a2c2e440011488b1f3a32e9414cf82`, but OpenShell v0.0.116 installation was blocked by outdated Apple Command Line Tools. The official standalone CLI archive was SHA-256 verified (`e582f2374053bebac8e6aaeb4a369931b7d4bb97bd55055e2c02e85502627e22`). No live network enforcement has been verified.
- Automatic approval review **rejected** starting the standalone local gateway because its root container would control the host Docker socket and other projects' containers. The gateway was not started. Explicit approval is needed for that access, or for bounded validation on the isolated VM. The temporary VM remains stopped.

Official references: [hackathon rules](https://nebiusglobalaihackathon.devpost.com/rules), [NVIDIA prerequisites](https://docs.nvidia.com/nemoclaw/user-guide/hermes/get-started/prerequisites), [pinned standalone gateway configuration](https://github.com/NVIDIA/OpenShell/blob/v0.0.116/deploy/docker/docker-compose.yml).

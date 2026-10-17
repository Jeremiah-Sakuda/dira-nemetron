# Serverless backend migration

Production cutover completed October 16. The Vercel frontend uses Cloud Run and Neon; both Nebius VMs and their managed boot disks are deleted after verified recovery. See the [verified recovery and sandbox review](../../docs/evidence/2026-10-16-migration-and-sandbox-review.md).

## Selected replacement

- Google Cloud Run, `us-east1`, request billing, 1 CPU / 512 MiB, minimum zero instances, maximum one. No continuously billed worker.
- Neon **Free** (`free_v3`), `iad1`. Dedicated application role with `NOSUPERUSER NOBYPASSRLS`; never give the service Neon administration credentials.
- Private Git memory remains Git history with reusable Skills. Encrypted bundles live in `dira_memory_bundles`, partitioned by forced account RLS. Local checkout directories are disposable; restore, Git operation and save hold a per-account database lock. A separate connection pool avoids deadlocking snapshot reads.
- One Cloud Scheduler job invokes `/internal/scheduled-pass` every fifteen minutes. It requires a high-entropy bearer credential, accepts no account/action parameters, and uses only host-provisioned accounts and owner-opted-in connectors. Daily reports retain durable idempotency. Models still cannot approve actions.
- One dedicated Secret Manager secret contains backend-only configuration. `bootstrap.ts` expands its JSON before startup. The runtime service account can access this secret only; no frontend or agent sandbox receives those credentials.

The deployment configuration is `DIRA_MEMORY_BACKEND=postgres`, `DIRA_MEMORY_ROOT=/tmp/dira-memory`, `DIRA_BACKGROUND_MODE=scheduled`, `DIRA_REQUIRE_SAFE_DB_ROLE=true`, `DIRA_DATABASE_POOL_SIZE=5`. Keep TLS verification enabled and preserve the existing session signing and token-encryption keys during migration.

Use the restricted role with Neon's **direct** connection for this backend. Startup currently runs schema migrations under a session-level advisory lock; PgBouncer transaction pooling cannot preserve that lock across statements. With a maximum of one Cloud Run instance and small pools, direct connections are bounded. Do not substitute the pooled URL until startup migrations have a separate direct connection. See [Neon connection pooling](https://neon.com/docs/connect/connection-pooling).

## Cost boundary

The old VM instances and managed boot disks have been retired. Cloud Run, Artifact Registry, Secret Manager and Cloud Scheduler have free allowances shared by billing account; they are not hard spending caps. Neon Free has quotas and can pause when exhausted. Do not upgrade Neon or configure minimum instances without a funding decision.

At 0.25 CU and five-minute database autosuspend, a fifteen-minute poll can consume approximately 62 compute-unit hours in a 31-day month before user traffic. Five-minute polling could prevent suspension and exceed the 100 CU-hour Free allowance. This is an estimate, not measured usage. Fifteen-minute polling also delays background detection compared with the VM's five-minute worker; manual sync remains immediate.

Keep registry storage within its free allowance, retain at most a small set of rollback images, and avoid paid Cloud Build by building locally. Model call quotas remain durable and unchanged across migration; failures still consume quota. These limits are not a provider-enforced dollar cap.

Sources checked October 14, 2026: [hackathon rules](https://nebiusglobalaihackathon.devpost.com/rules), [Neon](https://neon.com/pricing), [Cloud Run](https://cloud.google.com/run/pricing), [Artifact Registry](https://cloud.google.com/artifact-registry/pricing), [Cloud Scheduler](https://cloud.google.com/scheduler/pricing).

## Cutover and recovery gate

1. Save database and private-memory backups off the VM. Keep secrets and backups outside Git, mode 0600.
2. Verify a database restore into an isolated database. Validate the role has no RLS bypass, tenant isolation, durable ledger and approval records, and inference counters.
3. Export every retained account's complete Git history to encrypted durable storage. Verify bundle commit and byte equality after discarding the local checkout.
4. Quiesce old broker writes for the final snapshot. Restore schema/data to Neon through a private admin connection, then verify through the restricted app role. Preserve OAuth credentials and encryption key. Do not allow old and replacement workers to execute independently against divergent stores.
5. Deploy the replacement without changing the Vercel endpoint. Verify authentication, exact origins, approval hold, broker execution/read-back, scheduler unauthorized rejection and an authenticated scheduled pass.
6. Replace the Cloud Run revision/instance and verify account state, private-memory history/Skills, approval state and inference counters survive.
7. Change only Vercel's server-side backend endpoint and publish. Verify the public judge path without Vercel login; preserve credential-free replay.
8. Only after these checks, stop the old VM. Confirm backups remain recoverable before deleting billable instances/disks/IP resources. Stopping alone can leave storage charges.

## Human prerequisites

Neon is provisioned on `free_v3` in `iad1`, with no connected Vercel projects. The final production snapshot is restored and active on Cloud Run. The existing signing/encryption keys and inference reservations were preserved. Cloud Scheduler delivery, revision replacement, private Git recovery and the public approval/read-back path are verified. The separate Google OAuth web client is created and credentials are deployed through backend Secret Manager version 4; owner consent and actual provider verification remain pending. OpenShell was validated on the isolated Linux VM, which was stopped and then deleted; it is not active around the public Cloud Run broker.

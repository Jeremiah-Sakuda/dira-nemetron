# Vercel frontend

Production: https://dira-nemetron.vercel.app/try

Vercel project `dira-nemetron` belongs to `jeremiah-sakudas-projects` on the Hobby plan. Its Git connection is **Jeremiah-Sakuda/dira-nemetron**, production branch `main`, root directory `apps/web`, Node 22. The legacy repository is never a deployment target.

## Current architecture and cost

Vercel runs the Next.js product, its server-side API bridge, and credential-free deterministic Evidence replay. The existing Nebius VM still runs the orchestrator, Postgres, private Git memory, background work, action broker and backups. Real Nemotron inference continues through Nebius Token Factory.

The Vercel frontend uses the free Hobby allowance. **This deployment does not remove the existing VM charges or establish funded availability through December 15.** Do not stop the VM until replacement persistence, memory, background jobs and broker execution have been migrated and verified. Cloud Run plus a free Postgres service is a possible next migration; it has not been deployed. Free-tier quotas and billing eligibility must be checked before promising zero cost.

The official [hackathon FAQ](https://nebiusglobalaihackathon.devpost.com/details/faqs) permits hosting other app components elsewhere when the required NVIDIA model use is through Nebius Token Factory.

## Configuration

Production environment variables on Vercel:

| Name | Value |
| --- | --- |
| `DIRA_ORCHESTRATOR_URL` | `https://api.213-239-172-39.nip.io` |
| `DIRA_WEB_ORIGIN` | `https://dira-nemetron.vercel.app` |

No Nebius API key, database password, session signing key or Google client secret belongs on Vercel. The frontend forwards the browser's host-only signed cookie and original Origin to the backend; it does not manufacture approval or grant credentials to models.

On the backend, `DIRA_WEB_ORIGIN` is the Vercel production origin. `DIRA_ADDITIONAL_WEB_ORIGINS` explicitly retains `https://213-239-172-39.nip.io`. No wildcard or preview origin is trusted. Caddy exposes the account API/auth routes for the bridge; the service still checks signed sessions, account boundaries, policy and approval. Unmatched routes stay closed.

Configure a future Google web OAuth client with origin `https://dira-nemetron.vercel.app` and redirect `https://dira-nemetron.vercel.app/api/auth/google/callback`. OAuth remains unconfigured and actual Google changes remain unverified.

## Deployments and recovery

Push production source to `v2` only. The Vercel Git connection builds `main`. For a deliberate CLI deployment, run from the repository root:

```sh
vercel link --yes --project dira-nemetron --scope jeremiah-sakudas-projects
vercel deploy --dry --json
vercel deploy --prod --yes --scope jeremiah-sakudas-projects
```

Inspect the upload manifest before deployment. `.vercelignore` explicitly excludes environment files, database backups, private memory, runtime data and local tooling. The web build installs the monorepo from its root, then builds `apps/web`.

The production alias is public; generated deployment URLs and previews retain Vercel authentication. Previews have no backend environment configuration. Validate `/try`, account session creation/read-back and `/api/replay/stream?pace=0` on the public alias without a Vercel login.

For a frontend regression, promote the previous working Vercel deployment. The original Nebius web URL remains available as a fallback. Keep both exact trusted origins until the migration is complete. VM private environment backup: `infrastructure/nebius/dira.env.pre-vercel-20261014`; do not publish it.

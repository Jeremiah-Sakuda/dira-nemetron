# Vercel frontend

Production: https://dira-nemetron.vercel.app/try

Vercel project `dira-nemetron` belongs to `jeremiah-sakudas-projects` on the Hobby plan. Its Git connection is **Jeremiah-Sakuda/dira-nemetron**, production branch `main`, root directory `apps/web`. The legacy repository is never a deployment target.

## Current architecture and cost

Vercel runs the Next.js product, its server-side API bridge, and credential-free deterministic Evidence replay. Cloud Run hosts the orchestrator/broker; Neon Free holds operational state and encrypted private Git bundles; Cloud Scheduler invokes authenticated background passes every fifteen minutes. Real Nemotron inference continues through Nebius Token Factory.

The frontend uses Hobby and Neon uses Free. Replacement persistence, memory recovery, background delivery and public approval/read-back were verified October 16. Both Nebius VMs are stopped; their disks remain billable pending retirement. Google Cloud allowances are shared by billing account, so this is not a hard zero-dollar guarantee. See [measured evidence](../../docs/evidence/2026-10-16-migration-and-sandbox-review.md).

The official [hackathon FAQ](https://nebiusglobalaihackathon.devpost.com/details/faqs) permits hosting other app components elsewhere when the required NVIDIA model use is through Nebius Token Factory.

## Configuration

Production environment variables on Vercel:

| Name | Value |
| --- | --- |
| `DIRA_ORCHESTRATOR_URL` | `https://dira-nemetron-backend-683372642422.us-east1.run.app` |
| `DIRA_WEB_ORIGIN` | `https://dira-nemetron.vercel.app` |

No Nebius API key, database password, session signing key or Google client secret belongs on Vercel. The frontend forwards the browser's host-only signed cookie and original Origin to the backend; it does not manufacture approval or grant credentials to models.

The backend trusts the exact Vercel production origin. The retired VM origin is removed; wildcards and preview origins remain untrusted. The service checks signed sessions, account boundaries, policy, authenticated approval and its separate scheduler credential.

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

For a frontend regression, promote a verified deployment built with the Cloud Run backend endpoint. Pre-migration deployments point to the stopped VM and are not valid rollbacks without rebuilding their environment. Private final database/memory archives are under ignored `.dira-runtime/backups/final-20261016`; signing and encryption keys remain in private configuration and Secret Manager. Do not publish these files.

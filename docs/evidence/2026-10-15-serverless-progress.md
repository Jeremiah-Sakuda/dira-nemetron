# Serverless migration progress — October 15, 2026

**Production still uses the Nebius backend. VM costs have not yet been removed.**

- The owner completed Vercel sign-in and accepted the Neon marketplace terms.
- Provisioned `dira-nemetron-db`, resource `store_lBAjGTMxj4VkVdz0`, Neon project `damp-waterfall-03056894`, explicitly on **Free** (`free_v3`) in `iad1`, with managed Neon authentication disabled.
- Resource inspection reported **Available** and **no connected projects**. Database credentials have not been propagated to the Vercel frontend.
- Vercel requires a fresh authenticator/passkey check before revealing connection credentials. The prompt was brought forward in Chrome. No credentials have been printed or committed.
- Rebuilt the backend from published source `c8b451e` and deployed private Cloud Run staging revision `dira-nemetron-backend-00002-29p`. Image digest: `sha256:7926dda9b24dfeb4f0c065e82b12757bbd425314a64665897f3181c541d3a951`. It still lacks database, OAuth and inference configuration; readiness alone does not establish persistence.
- Verified the replacement revision on native Cloud Run: authenticated health **200** (`ok: true`), anonymous health **403**. Existing Nebius backend health remained **200** and the public Vercel `/try` page returned **200**. No model inference calls were made for these checks.
- Production restore, restricted-role checks, encrypted-memory recovery on Cloud Run, authenticated scheduled execution, instance replacement and public endpoint cutover remain required before stopping the production VM.
- Google client creation, consent and real synthetic Calendar/Gmail verification remain pending.
- The sandbox validation VM remains stopped. Automatic approval review previously rejected granting the local gateway control of the host Docker daemon. No live OpenShell network enforcement is claimed.

The [migration runbook](../../infrastructure/serverless/README.md) retains the recovery and retirement gates. Earlier isolated recovery evidence is in the [October 14 review](2026-10-14-serverless-preparation-review.md).

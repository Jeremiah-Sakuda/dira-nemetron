# Launch and judging readiness — October 14, 2026

## Completed and measured

- Published code/evidence/video draft to `dira-nemetron` only at `34c8d23`; GitHub checks passed. October 14 added Vercel hosting and exact trusted-origin support. The Vercel Git connection uses v2 `main`; the backend image includes the origin changes at `ead2893` and the server routing checkout is `897738d`. The original VM web remains the fallback.
- Public HTTPS frontend: https://dira-nemetron.vercel.app/try on Vercel Hobby. Existing fallback: https://213-239-172-39.nip.io/try. API health: https://api.213-239-172-39.nip.io/health. The frontend deployment preserves the VM backend and its charges; see [Vercel configuration](../../infrastructure/vercel/README.md).
- Persistent Postgres, per-account isolation, private Git memory, broker and web deployment.
- Live Super interpretation and Ultra proposals through Nebius Token Factory. Final synthetic corpus: 8/8 interpretation cases; 7/7 repair scenarios; no truncated Ultra calls. See [evidence review](../evidence/2026-10-13-bounded-model-review.md).
- Global durable inference admission: 100 lifetime attempts, 20 rolling-day, 12 rolling-hour, two concurrent. Failed/unknown calls retain quota. These are call limits, not a dollar cap.
- Nightly database and memory backup configured for 03:15 UTC; a fresh private backup taken October 13. Docker restart policies are enabled. A backup was restored successfully into an isolated database (nine inference reservations retained), and private database/memory copies were saved off-VM locally. The database restore is verified; the memory archive is readable but a complete memory-to-new-VM recovery remains untested.
- Credential-free Evidence replay remains available without model inference or OAuth.
- A 2:29 English narrated screen-capture draft is ready at `docs/demo/v2/dira-v2-walkthrough-draft.mp4`; Devpost copy and honest verification boundaries are updated. Public upload/submission remain pending.

## Required before claiming completion

October 14 migration preparation: encrypted durable memory and authenticated scheduled jobs are implemented; eleven focused checks and an isolated restore passed. A private Cloud Run staging service boots, but its database is not configured and Vercel still points to the VM. Neon creation awaits Vercel 2FA/terms acceptance. Local OpenShell installation hit Apple's developer-tools prerequisite, and automatic approval review rejected broad Docker-socket access for the standalone gateway. See [preparation evidence](../evidence/2026-10-14-serverless-preparation-review.md). These are prerequisites to finish, not a completed cost removal or sandbox deployment.

| Work | Concrete next action | Completion evidence |
| --- | --- | --- |
| Google OAuth | Finish Cloud console login; create/configure a web client; keep credentials in ignored `infrastructure/nebius/dira.env`; choose a controlled test account/recipient | Actual source change, authenticated owner approval, Calendar/Gmail broker actions, and independent provider reads; publish only redacted metadata |
| Sandbox | Approve a bounded restart of the stopped 4 vCPU / 16 GiB VM; install maintained NemoClaw/Hermes and inspect its pinned OpenShell version | Allowed host succeeds from the agent runtime, forbidden host and cloud metadata fail, method restrictions fail, matching enforce-mode logs; stop VM afterward |
| Stable hosting | Vercel frontend is deployed; migrate backend, database, memory and background work to lower-cost hosting, or fund the existing VM | Full persistent workflow and recovery verified on replacement hosting; free judge access remains available through December 15 |
| Submission | Code and reviewable 2:29 video draft are published in v2; finish verified footage/public YouTube upload and submit Devpost | Public video URL, completed required fields and actual submission confirmation |

## Funding decision

Cloud balance observed in the console: **$24.11**. Token Factory inference credits are separate and cannot pay for the VM. The [official FAQ](https://nebiusglobalaihackathon.devpost.com/details/faqs) confirms that the hackathon promo and Builders Program credits are Token Factory credits and that there is no separately published AI Cloud credit grant. The existing demo VM was quoted at roughly **$0.08/hour including its selected disk**, or $1.92/day. About 63 days from October 13 through December 15 therefore needs roughly **$121**, before any unquoted charges or taxes. The observed balance covers only about 12.6 days at that rate. No new funds or automatic top-up were authorized or enabled by this work.

The temporary validation VM was quoted at about $0.15/hour including its selected disk. It remains stopped pending authorization to use at most $0.50 of the existing balance. Stopped storage can still incur charges. Do not restart it for ongoing hosting.

**Selected direction:** Vercel Hobby now hosts the frontend and credential-free replay. The next cost reduction is migrating the orchestrator and broker to Cloud Run, with durable Postgres and a replacement for local Git memory/background timers. That migration is not implemented yet; do not stop the current backend or promise zero-cost full-product availability through December 15. Token Factory remains the inference provider, as allowed by the official FAQ.

Official rules rechecked October 13: [rules](https://nebiusglobalaihackathon.devpost.com/rules). A functional test build with free judge access is required; a hosted website is one delivery option. Submission closes October 30 at 10:00 AM Pacific; judging runs December 1–15. Track fit and meaningful Nebius/NVIDIA use remain the first-stage gate; implementation, design, impact, and idea have equal second-stage weight.

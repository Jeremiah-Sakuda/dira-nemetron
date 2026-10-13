# Launch and judging readiness — October 13, 2026

## Completed and measured

- Public HTTPS demo: https://213-239-172-39.nip.io/try. API health: https://api.213-239-172-39.nip.io/health.
- Persistent Postgres, per-account isolation, private Git memory, broker and web deployment.
- Live Super interpretation and Ultra proposals through Nebius Token Factory. Final synthetic corpus: 8/8 interpretation cases; 7/7 repair scenarios; no truncated Ultra calls. See [evidence review](../evidence/2026-10-13-bounded-model-review.md).
- Global durable inference admission: 100 lifetime attempts, 20 rolling-day, 12 rolling-hour, two concurrent. Failed/unknown calls retain quota. These are call limits, not a dollar cap.
- Nightly database and memory backup configured for 03:15 UTC; a fresh private backup taken October 13. Docker restart policies are enabled. A backup was restored successfully into an isolated database (nine inference reservations retained), and private database/memory copies were saved off-VM locally. The database restore is verified; the memory archive is readable but a complete memory-to-new-VM recovery remains untested.
- Credential-free Evidence replay remains available without model inference or OAuth.
- A 2:29 English narrated screen-capture draft is ready at `docs/demo/v2/dira-v2-walkthrough-draft.mp4`; Devpost copy and honest verification boundaries are updated. Public upload/submission remain pending.

## Required before claiming completion

| Work | Concrete next action | Completion evidence |
| --- | --- | --- |
| Google OAuth | Finish Cloud console login; create/configure a web client; keep credentials in ignored `infrastructure/nebius/dira.env`; choose a controlled test account/recipient | Actual source change, authenticated owner approval, Calendar/Gmail broker actions, and independent provider reads; publish only redacted metadata |
| Sandbox | Approve a bounded restart of the stopped 4 vCPU / 16 GiB VM; install maintained NemoClaw/Hermes and inspect its pinned OpenShell version | Allowed host succeeds from the agent runtime, forbidden host and cloud metadata fail, method restrictions fail, matching enforce-mode logs; stop VM afterward |
| Stable hosting | Choose domain or retain nip.io; reserve/preserve public address; fund the entire judge period | URL survives a controlled restart, TLS renews, full off-VM recovery succeeds, and Cloud funds cover December 15 |
| Submission | Publish to `dira-nemetron` only; review current claims; finish public English video under three minutes; submit Devpost | Public repo revision, video URL, completed required fields and actual submission confirmation |

## Funding decision

Cloud balance observed in the console: **$24.11**. Token Factory inference credits are separate and cannot pay for the VM. The existing demo VM was quoted at roughly **$0.08/hour including its selected disk**, or $1.92/day. About 63 days from October 13 through December 15 therefore needs roughly **$121**, before any unquoted charges or taxes. The observed balance covers only about 12.6 days at that rate. No new funds or automatic top-up were authorized or enabled by this work.

The temporary validation VM was quoted at about $0.15/hour including its selected disk. It remains stopped pending authorization to use at most $0.50 of the existing balance. Stopped storage can still incur charges. Do not restart it for ongoing hosting.

**Recommendation:** keep the small existing VM for the complete persistent product if funding permits. For $0 additional spend, keep the source/test build and credential-free replay as the submission access path and clearly describe hosted-demo availability; do not promise funded uptime through December 15. A static frontend alone does not run Postgres, the broker, or persistent assistant workflows.

Official rules rechecked October 13: [rules](https://nebiusglobalaihackathon.devpost.com/rules). A functional test build with free judge access is required; a hosted website is one delivery option. Submission closes October 30 at 10:00 AM Pacific; judging runs December 1–15. Track fit and meaningful Nebius/NVIDIA use remain the first-stage gate; implementation, design, impact, and idea have equal second-stage weight.

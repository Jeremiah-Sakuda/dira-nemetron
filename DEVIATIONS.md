# Deviations from the v2 PRD and evidence boundaries

This file records every deliberate departure from [`docs/product/dira-v2-prd.md`](docs/product/dira-v2-prd.md). It also records every boundary a judge should know about. Simulated and unverified pieces are named, never implied to be live.

1. **Demo persona surfaces are simulated per session, not a per-session Google calendar.**
   - The PRD asks for a calendar and a message tag per session in a demo Google account. The demo instead uses Postgres-backed simulators: a calendar, a mailbox, and a counterparty slot list, isolated by row-level security and labeled "simulated" everywhere.
   - Why: concurrent judges cannot interfere, nothing can reach a real address, and the path needs no Google credentials through December. The engine, policy, ledger, approvals and read-back verification are the same code real accounts use.
2. **Without a Nebius key, the demo runs on stored interpretations.**
   - Sample emails use stored Super interpretations and a stored Ultra proposal. The screen and flight record label this "no inference".
   - With `NEBIUS_API_KEY` set, Super and Ultra run live and the judge can edit the email.
3. **The broker is not inside an OpenShell sandbox.** The broker holds OAuth credentials, so the PRD places it outside the sandbox. We do too. It enforces the same egress allowlist in-process, with an audited HTTP 403. OpenShell enforces default-deny egress for each account's Hermes sandbox.
4. **Hermes's chat agent relays changes; it does not apply them.** "Tell Hermes my midterm moved" stores a note. The note runs only after the owner confirms it in the web app, and it can change only the owner's own commitments.
5. **Approvals use Dira's own Telegram bot, not Hermes's.** Hermes's approvals are text replies a model reads. Dira's buttons carry single-use nonces checked outside any model.
6. **Delegation on a personal account has no task tracker.** Ownership is recorded in Dira's delegation record, which is internal state. The external, verified effect is the notification to the backup.
7. **Booking a counterparty-offered time is a reply plus a tentative hold.** The booking stays `AWAITING_COUNTERPARTY` until the counterparty confirms. Email offers cannot be checked live in advance, so the demo's counterparty simulator models a time that was already taken. That is the source of the 409.
8. **Live runs not yet captured in this repository:**
   - the Nemotron evals and routing cost report (they need `NEBIUS_API_KEY`);
   - Google account flows against live credentials;
   - Nebius VM, Serverless Job, NemoClaw and OpenShell commands.

   Scripts and policies follow the official docs. See [`infrastructure/README.md`](infrastructure/README.md).
9. **P1 items not built:** Tavily source checks, extension and renegotiation actions, the professional/Asana persona, Parakeet voice intake, exportable skill bundles beyond the memory repo, Canvas REST, and Calendar push.
10. **The v1 Gemma voice intake was removed with the Google Cloud runtime.** Its captured run stays in `docs/evidence/v1`.

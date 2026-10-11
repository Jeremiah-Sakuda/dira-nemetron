# How Dira v2 differs from v1

Dira v1 was built for an earlier Google agentic hackathon. That submission is tagged `v1-google-agentic` (commit `3a1b433`). The full diff:
<https://github.com/Jeremiah-Sakuda/dira-nemetron/compare/v1-google-agentic...main>

## What carried over

The deterministic core carried over:

- the commitment model and typed-edge propagation;
- the global-slack feasibility solver;
- the enumerated planner, plan validator and cost function;
- the policy engine and the durable action ledger with crash-resume.

Its unit, property, chaos and 20-run replay tests still run in CI, and the golden 48-Hour Shock replay still passes 18 of 18 assertions. The v1 captured evidence is kept under `docs/evidence/v1` and labeled as v1.

## What changed

| Area | v1 | v2 |
| --- | --- | --- |
| Model and inference | Gemini on Vertex AI, one model for interpretation | Nemotron 3 on Nebius Token Factory, routed by job: Nano for drafts, Super for interpretation, Ultra for edges and repair plans. Every call carries tier, latency and token telemetry. |
| What the model proposes | One structured interpretation of an email | Also graph drafts, typed edges, and structured repair plans. Ultra plans cite typed provenance, which a deterministic compiler resolves before the validator and policy see them. |
| Users | One shared demo world behind a shared token | Google sign-in with PKCE, signed sessions, encrypted tokens, per-account Postgres with forced row-level security, and an isolated no-OAuth demo account per visitor. |
| Integrations | A real service-account calendar plus three Firestore test doubles (recruiter, organization, outbox) | The user's own Google Calendar and Gmail. Gmail is read through incremental history and written as drafts or sends, scope by scope. iCalendar deadline feeds. Counterparty bookings by reply, held as awaiting the counterparty. A delegation record. The Firestore doubles and Cloud Run deployment are deleted. |
| Approvals | None; plans needing approval stopped | `AWAITING_APPROVAL` in the ledger. Approval comes from an authenticated web action or a nonce-checked Telegram button. Fresh-state revalidation happens before resume. |
| Safety | Provenance, policy and sender checks inside one world | Also commitment-scoped authority, recipient restriction to stored stakeholders, template-only message bodies, versioned per-account policy, fences, draft-only, an egress allowlist with an audited 403, and an OpenShell default-deny policy per Hermes sandbox. |
| Memory and skills | None | A private Git memory repo per account with export and validated restore. Correction-to-rule capture with owner confirmation. Rules mirrored as read-only Hermes Skills. |
| Product | An evidence dashboard | Landing page, demo console, Today, plan-centric approvals inbox, Activity with flight records, Graph review, Rules, Settings and Setup. Hermes chat through MCP and Telegram approvals. The v1 replay lives on the Evidence page. |
| Infrastructure | Google Cloud Run, Firestore, Vertex AI, Pub/Sub scripts | A Nebius VM (Postgres, broker, web, Caddy, NemoClaw/OpenShell), Nebius Serverless Jobs for the daily pass, and Nebius Token Factory. |

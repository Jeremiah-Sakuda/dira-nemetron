# Dira v2 implementation plan

This plan translates [`dira-v2-prd.md`](dira-v2-prd.md) into reviewable stages. Build order follows the PRD's P0 dependencies. A release is judge-ready only when it clears the Stage One viability gate and has credible evidence for all four equally weighted judging criteria.

## Judging map

| Criterion | Product evidence to build |
| --- | --- |
| Technological Implementation | Runtime Nemotron calls through Nebius Token Factory; deterministic validation/policy/broker boundary; real calendar, Gmail, and feed adapters; reliable scheduling; measured latency, tokens, cost, and proposal validation. |
| Design | Working sign-in and onboarding; reviewed commitment graph; polished approvals inbox and morning summary; phone-sized web experience; no-setup synthetic judge path with verified before/after state. |
| Potential Impact | Demonstrate a real student promise cascade end to end; explain the professional use case using the same engine and honest Asana/iCal support claims; show time-to-detection and what obligations were protected. |
| Quality of the Idea | Show the non-obvious commitment graph and cascade repair; make Nemotron's extraction/edge/plan proposals visible; demonstrate that deterministic code—not the model—authorizes and verifies actions. |

**Stage One pass/fail gate:** the product must genuinely fit Personal AI and make meaningful runtime use of Nebius Token Factory or eligible Nebius AI Cloud compute plus an NVIDIA open-source model. The judge path must work consistently and match the claims in the submission.

## Working product decisions

To keep implementation moving, use these reversible defaults until the owner changes them:

- Google-only sign-in for the first release.
- A per-user Git repository on the Nebius VM is the source of truth for graph, rules, and policies; provide clone/download and export.
- Postgres runs on the VM for the first deployment, with backups documented.
- Draft-only is enabled by default for real accounts and disabled only for the isolated synthetic demo persona.
- Telegram is the first Hermes messaging channel; the web inbox remains the authoritative approval surface.
- Keep the Dira name and v1 deterministic evidence.
- Target Best Use of Tavily if the source-check integration is completed and shown working.
- The video leads with the student cascade; include the professional/Asana persona only if it can be demonstrated as a real adapter path rather than a synthetic claim.

## Build stages

### 0. Repo and product baseline

- Keep the v1 deterministic core, replay fixtures, and evidence intact while v2 grows around them.
- Preserve the supplied PRD in `docs/product/dira-v2-prd.md`; this plan is the delivery checklist.
- Work on a local v2 branch. The configured `origin` belongs to the legacy Dira repo and must never receive v2 pushes. The new public repository `Jeremiah-Sakuda/dira-nemetron` is configured as remote `v2`; publish v2 only there.
- Record any change to the working defaults above before its dependent implementation stage.

**Exit:** the product decisions needed for the next implementation stage are recorded; local deterministic replay remains an available baseline.

### 1. Nemotron model path (P0.1)

- Add a Token Factory OpenAI-compatible model client behind `ModelClient` and route live interpretation to Nemotron 3 Super.
- Enforce structured output and existing Zod validation; keep bounded retries and safe-stop behavior.
- Record model id, latency, token usage, and provider in the flight/eval artifacts.
- Run the existing eight-case interpretation corpus on the configured Nemotron model and publish the result.

**Exit:** configured live calls reach Token Factory, pass the existing schema/entity/sender gates, and the eight-case corpus has a reproducible report.

### 2. Accounts, persistence, and time (P0.2)

- Add Google OAuth with signed HttpOnly sessions, CSRF state, PKCE, verified account identity, and Google Calendar timezone discovery. Start with read-only Calendar scopes; request write scopes in a separate step when the approval workflow is ready. The web app connects through same-origin route handlers so the session cookie stays on the app origin.
- Store Google OAuth credentials encrypted with AES-256-GCM; keep refresh tokens server-side and refresh access tokens before adapter use.
- Add Postgres account, state, event, workflow, action ledger, and credential tables with forced row-level security scoped by a transaction-local account id.
- Replace global Firestore workflow state with Postgres-backed, per-account partitions.
- Add account identity, timezone, and absolute ISO timestamps; derive solver horizons from current time.
- Move graph/policy memory to a per-user Git repository with import/export and durable commits.

**Current:** OAuth routes, web onboarding/sign-out, encrypted credential storage, token refresh, account schema, RLS migration, per-user `DomainState` bootstrap, and signed-in Google Calendar reads are implemented. Calendar event write scope is available through a separate, identity-bound incremental consent flow; the adapter checks the stored grant before every mutation. Users can save recurring focus hours in their calendar timezone; the service expands them into a re-anchored 90-day solver horizon. A private schedule check runs the deterministic feasibility, candidate generation, validation, and policy engines. Confirmed graph proposals now enter the account state through a user decision. The service's live Google/Postgres credentials are not configured in this workspace.

**Exit:** two accounts cannot read or mutate each other's state; timezone and persistence survive restarts.

### 3. Security boundary and policy (P0.3–5)

- Run one OpenShell sandbox per account; keep OAuth credentials and provider APIs in an out-of-sandbox broker.
- Implement the egress allowlist and auditable blocked-request records.
- Resolve typed provenance references against stored facts and restrict recipients to stakeholders on the target commitment.
- Add `AWAITING_APPROVAL`; re-read external state and re-run feasibility and policy when approval resumes.
- Store editable per-user policy and confirmed correction rules in the memory repo.

**Current:** A user-requested deterministic account schedule candidate creates a per-account Postgres workflow and records every action; autonomous actions remain authorized but held while approval-required actions await the account owner. Approval re-reads relevant Calendar items, re-anchors the horizon, reruns feasibility/validation/policy, and requires the complete action-intent set to match. After all decisions, a serialized out-of-model broker revalidates the plan, checks policy again, resumes the ledger, mutates only supported Calendar actions through the scope-gated adapter, independently verifies each mutation, and commits verified results to the account graph. Resume evidence is durable, action identity no longer depends on a process-local row position, and deterministic Calendar identifiers allow recovery after interrupted writes. Rejection invalidates sibling actions. Live OAuth/Postgres credentials, deployment validation, non-Calendar broker actions, and full real-world multi-action recovery still need work.

**Exit:** adversarial model proposals, forged provenance, outside recipients, fenced sources, and stale approvals are rejected or safely held; only user-sourced approval records can authorize an approval-required action.

### 4. Real read sources and always-on intake (P0.6)

- Add user OAuth for Google Calendar and Gmail with scopes requested only as needed.
- Add iCal deadline-feed polling and source snapshot diffs.
- Poll Gmail/Calendar every five minutes and feeds every thirty minutes; route every change through `handleEvent`.
- Add a nightly whole-horizon recompute and 07:00 user-time summary scheduler.

**Exit:** a source change enters the same verified repair path without a manual trigger; source failures are visible and recoverable.

### 5. Graph builder and user review (P0.7)

- Use Nemotron 3 Nano to extract commitment drafts and Nemotron 3 Ultra to propose typed edges.
- Require user confirmation for all proposed commitments and edges, with authority and effort editable in review.
- Persist rejected proposals; never propagate across an unconfirmed edge.
- Permit delegatable edges only when a source or user explicitly names the backup.

**Current:** Nemotron Nano can turn upcoming Google Calendar entries into strict, typed drafts. Drafts are stored per account, can be edited/confirmed/rejected in onboarding, and enter the working `DomainState` only in the same transaction that records user confirmation. A user can classify a calendar item as deadline-driven effort and enter the required focus-time estimate; the model cannot invent that amount. After at least two commitments are confirmed, Nemotron Ultra can propose typed edges; proposals are validated against the user's graph and stay inert until confirmed. Both model calls require an explicit user action and send only commitment titles, domain, and dates. Ownership and delegation edges are excluded because no person evidence is available. Authority fields, non-Calendar extraction, and edge source evidence remain to build.

**Current account schedule path:** The authenticated account flow executes deterministic feasibility analysis, plan validation, and policy over its confirmed graph and user-declared focus windows. A feasible candidate containing `REQUIRE_APPROVAL` actions is recorded durably with all sibling actions. Account owners grant Calendar write scope separately. Once all required actions are approved, the broker repeats fresh-read and feasibility/policy checks; supported Calendar changes run through the user adapter and are read back before the graph changes. Unsupported action types stop in `WAITING_REVIEW`. This path has not yet been exercised against configured live Google/Postgres credentials.

Model defaults are configurable by tier: Nano `nvidia/nemotron-3-nano-30b-a3b`, Super `nvidia/nemotron-3-super-120b-a12b`, Ultra `nvidia/nemotron-3-ultra-550b-a55b`. Recheck the [Nebius Token Factory Nemotron catalog](https://nebius.com/services/token-factory/models/nvidia-nemotron-models-inference) before deployment because availability and model IDs can change.

**Exit:** confirmed graph is partitioned by user; unconfirmed or rejected proposals cannot affect propagation.

### 6. Repair proposer and action safety (P0.8–10)

- Add Ultra as a structured candidate source alongside existing enumerated candidates.
- Validate action type, target, provenance, stakeholder, schedule, feasibility, and policy before selection.
- Add real BOOK_SLOT, DELEGATE_TASK, and SEND_NOTIFICATION through the broker; add extension and renegotiation actions as P1.
- Draft messages from deterministic briefs; keep draft-only as a per-user policy.
- Verify every mutation from a fresh read and preserve crash-resume behavior.

**Exit:** variation scenarios resolve or stop with a stated reason; no model proposal bypasses validation or policy; eval reports validation rate and Ultra win share.

### 7. Product surfaces and memory skills (P0.9, P0.11)

- Build onboarding, graph review, approvals inbox, editable policies, fenced zones, and privacy controls.
- Add Hermes via NemoClaw with read/report-only Dira tools and read-only mirrored Skills.
- Capture edits/rejections as candidate rules and require user confirmation before the planner uses them.
- Polish the approvals inbox and morning summary first; keep the UI usable on phones.

**Exit:** approvals can be reviewed/edited/rejected in web UI; Hermes cannot approve, confirm, or send; confirmed user rules affect a subsequent plan.

### 8. Deployment, demo, and submission evidence (P0.12–13)

- Deploy on a Nebius VM with Postgres, broker, scheduler, and OpenShell gateway; use Serverless Jobs for nightly recompute and Serverless Endpoints for ASR if included.
- Keep the no-OAuth synthetic demo isolated per session and refuse recipients outside the synthetic account.
- Add an evidence page retaining deterministic v1 replays and linking Nemotron eval, routing cost report, and injection proof.
- Update README with actual provider/model/runtime details, setup, limitations, feedback, and significant-update explanation.
- Produce and rehearse a sub-three-minute English demo; keep the hosted judge build free and available through December 15, 2026.

**Exit:** clean judge setup is documented and reproducible; no-setup path reaches a verified repair in under three minutes; submission artifacts are public and consistent with live behavior.

### 9. P1 improvements

- Tavily checks for publicly published dates.
- Request-extension and renegotiation workflows.
- Professional/Asana persona, Parakeet voice intake, exportable skill bundles, Canvas REST, and Calendar push.

Prioritize these after all P0 safety and judge-path exits hold. Do not claim unsupported tracker sources or authenticated-page verification.

## Release gates

1. **Safety:** every action has resolved provenance, a deterministic verdict, broker recheck, approval where required, and fresh-read verification.
2. **Reliability:** existing deterministic replay and core regressions remain intact; event processing resumes safely after failure.
3. **Stage One:** documented real Token Factory/Nebius runtime call and an NVIDIA open model are part of the working application; Personal AI features are demonstrable.
4. **Judging:** each of the four criteria has a concrete product surface and a rehearsed piece of evidence; synthetic and live paths are labeled accurately.
5. **Submission:** public source, setup/run instructions, license, hosted demo, English video under three minutes, feedback, and pre-existing-project update explanation are complete.

## Source of judging requirements

Official Devpost rules and judging criteria: <https://nebiusglobalaihackathon.devpost.com/rules>. Organizer judging explainer: <https://nebiusglobalaihackathon.devpost.com/updates/46204-here-s-how-judging-works>. Re-verify these sources before submission because schedule and eligibility rules can change.

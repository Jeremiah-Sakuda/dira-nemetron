# Round 2 — independent product/design review

> October 30 editorial correction: the internal Potential Impact score and aggregate mean are withdrawn. The assessment now follows the official problem, audience and demonstrated-solution criterion. Other numerical scores describe the original October 18 snapshot.

Reviewed October 18, 2026. Source snapshot: `e17b24a`. Deployment IDs and visual verification are to be appended by the parent; source inspection is not proof that this revision is deployed. Internal AI review, not an official result or prediction.

## Method and gate

Read AGENTS.md, the judging protocol and round-2 context, current landing/Try/Today/Setup/Evidence components, model-budget state, public submission copy, and the iteration change record. The UI/UX Pro Max feedback/recovery guidance from round 1 remains applicable. No tests, inference, browser operation, private runtime reads or sibling scorecards were used. The existing October 16 Setup images provide historical layout context only. No DNS or service outage is inferred.

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules), read October 18, retain the viability/track/API gate and equally weighted four criteria.

**Stage One: provisional pass on supplied evidence.** Persistent private commitments, confirmed reusable rules, reviewed tool access and scheduled checks fit Personal AI; actual recorded Super/Ultra calls on Nebius Token Factory materially interpret changes and propose repairs. The public action path remains simulated. Actual synthetic Calendar mutation and operator-provisioned Gmail draft creation/recovery are separate narrow evidence. The optional owner Hermes runtime has a separate enrollment step.

**Submission compliance: open.** Revised public YouTube footage, completed Devpost entry and free access through December 15 remain unconfirmed. Source contains license, English materials and significant-update/feedback documents, but this review does not establish final publication or submission. Google Testing continuity and inference coverage remain operational dependencies. Credential-free replay is useful fallback evidence, not proof of live-model availability throughout judging.

## Scores

Internal 0–10 scale; equal-weight mean **7.375/10**.

| Criterion | Score | Assessment |
| --- | ---: | --- |
| Technological Implementation | 7.5 | Typed proposals, deterministic approval/execution gates and independent read-back remain substantive. Recorded provider checks support the implementation. Improved Calendar race handling and quota admission are supported by the supplied change record, rather than independently executed here. Owner runtime and sustained intake remain incomplete. |
| Design | 7.5 | Important trust defects are corrected: the visible subject is submitted, initial load failure exposes retry/replay, and Today distinguishes unknown status from empty state. Landing and hosting copy is more honest. Product completeness is still limited by missing monitoring health, hidden current evidence and a long mobile path to the first action/result. No new visual or timed completion proof was supplied in this review. |
| Potential Impact | — | Students coordinating coursework, recruiting and team responsibilities face a specific dependency problem. The demonstrated exam-change cascade connects that problem to an approved, verified schedule repair. |
| Quality of the Idea | 8.0 | Repairing the chain of promises through dependency-aware plans and confirmed reusable corrections remains distinctive. Ultra's contribution beyond the enumerator is credible in the recorded overlap scenario. Recurring monitoring and recovered skill reuse are less visible than the initial repair. |

## Confirmed source corrections

- `apps/web/lib/demo-input.ts:3` compares sender, subject and body; Try uses it at `components/demo-console.tsx:76` and sends edited values at `:110`.
- Try's loading branch renders the error, retry and replay link (`demo-console.tsx:145`). Today catches network/HTTP failures and labels approvals/history unavailable (`today-view.tsx:28`, `:32`, `:52`, `:57`).
- Morning summary now links to `/onboarding?section=focus#schedule-check` (`morning-summary.tsx:54`), and Setup reads the `section` query (`account-setup.tsx:30`). The source resolves the previous wrong-page target; arrival focus/scroll after asynchronous rendering still needs browser verification.
- Try uses actual durable allowance status instead of configuration alone (`demo-console.tsx:177–185`, `:245`). Lifetime exhaustion correctly calls for an operator decision rather than claiming a reset (`services/orchestrator/src/inference-budget.ts:123`). Landing conditions scheduled processing on opt-in/enrollment and Hermes on separate enrollment; Devpost hosting now matches the migration.

## Remaining actionable findings

### 1. P1 — Read-back and allowance status can become stale without telling the user

Try silently ignores a non-OK `/api/surfaces` read (`components/demo-console.tsx:63–68`) and keeps the prior `surfaces`. The verification panel nevertheless calls them “Fresh reads” (`:285`). If the failed read occurs after approval, the displayed world can be older than the workflow state. Similarly, the trigger catch only sets an error (`:118–120`), so a quota race/failure need not refresh the green availability badge. When paused allowance does reset, the panel has no recheck control; the send button stays disabled until an unrelated refresh/reset (`:185`, `:245`).

**Acceptance:** independently fail a surface read and show verification unavailable or explicitly timestamped stale data, never an unqualified fresh-read claim. Refresh allowance after admission failure and provide a non-destructive “Check availability” action. Once a rolling window resets, that action re-enables delivery without resetting the week. These are proposed checks, not executed results.

### 2. P2 — Today still cannot show whether any source is being monitored

Its subtitle promises “What Dira is watching” (`components/today-view.tsx:47`), but the rendered cards contain approvals and recent runs, followed by relayed notes and a non-demo-only morning summary (`:49–69`). There are no connector states, last successful checks or failed/paused processing indicators. The empty summary still instructs users to involve the deployment operator (`morning-summary.tsx:37`). This makes the central always-on benefit difficult to inspect even when correctly qualified in marketing copy.

**Acceptance:** show chosen sources as enabled/paused/disconnected/error, their last successful check and the next appropriate setup/recovery action. Label demo monitoring explicitly simulated. Display cadence only for enrolled processing. A user should be able to tell whether Dira is watching anything from Today itself.

### 3. P2 — Evidence landing hides the strongest current provider proof

The Evidence intro describes proofs carried over from v1 and links only to the stored replay, ledger, reference commitments and graph (`app/evidence/page.tsx:25–34`). The newer actual Calendar and Gmail draft-only checks, bounded live Nemotron results and separate sandbox validation live in repository documents. A judge following the website's obvious Evidence route can reasonably conclude all execution evidence is simulated, overlooking the best current work.

**Acceptance:** add a compact evidence index near the top with dated source/revision, what actually ran, result, limitation and a direct artifact link. Distinguish live Nemotron with simulated adapters, actual synthetic Calendar, operator-provisioned Gmail draft-only, separate OpenShell and deterministic replay. Surface Ultra's accepted-plan/win counts, not only all-scenario resolution. No credentials or personal account identifiers may be included.

### 4. P2 — Mobile action/result discovery remains weak

The full week still precedes the composer (`components/demo-console.tsx:188–248`); below 860px the layout becomes a single column (`app/globals.css:1936`). The new result remains below both panels (`demo-console.tsx:251`), with the open trace before verified changes (`:275–285`). No jump, focus handoff or short outcome path has been added. This is a source-based risk, not a measured completion-time failure.

**Acceptance:** at 390px and desktop, expose a direct first-action cue, guide focus to the new status/approval after delivery, and make the verified outcome discoverable before the full trace. Keep detail available through disclosure. Observe an uncoached visitor complete default email → approval → verified outcome inside the documented three-minute target.

### 5. P2 — Some entry points still imply general Google/Telegram availability

Landing's secondary CTA remains “Sign in with Google” (`components/start-buttons.tsx:35`), and signed-out Setup still offers “Continue with Google” without explaining the owner pilot (`account-setup.tsx:153–155`). The deployment permits only the configured verified owner. The demo approval text still says the decision arrives as a Telegram button on a phone (`demo-console.tsx:271`), while owner Telegram enrollment is incomplete. The improved landing qualifications do not cover these immediate action points.

**Acceptance:** label owner-only Google access before redirecting into consent, with a clear no-sign-in demo route for everyone else. Condition Telegram delivery on a linked/configured account. Check the unsigned landing, Setup and pending-demo-approval states for the same availability vocabulary.

## Claim limits

The simulated-world disclosure, credential-free labels and explicit absence of public OpenShell enforcement are preserved and useful. The narrower landing statement that updates are prepared as drafts by default is an improvement. Google evidence covers Calendar repair and self-addressed draft recovery. The optional Hermes companion has separate runtime configuration.

# Round 1 — independent product/design review

> October 30 editorial correction: the internal Potential Impact score and aggregate mean are withdrawn. The assessment now follows the official problem, audience and demonstrated-solution criterion. Other numerical scores describe the original October 18 snapshot.

Reviewed October 18, 2026 against source snapshot `efd6a26` and the supplied deployment context: frontend `dpl_6FZmNNUE2K4CeooC9xU8Ww2JuoRj`, backend `dira-nemetron-backend-00014-xtd`. Internal AI review; these scores are not official judgments or predictions.

## Basis and limits

I read the repository guidance, PRD, round context, public-facing page/component source, README, judge checklist, Devpost copy, and public evidence index. I inspected the October 16 desktop/mobile Setup screenshots. The screenshots show a synthetic preview account and establish layout evidence only; they do not establish deployed Google enrollment. I did not operate the browser, invoke inference, run tests, inspect private runtime data, or read other reviewers' reports. Behavioral defects below are source findings, with acceptance checks proposed for the implementation pass, not executed checks.

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules), read October 18, specify a viability/track/API gate and four equally weighted criteria. The UI/UX Pro Max skill informed the navigation, feedback and recovery review; its targeted feedback search emphasizes explicit loading states and actionable errors.

## Stage One and submission compliance

**Stage One: provisional pass on supplied evidence.** This is a credible Personal AI product: persistent commitment relationships, private account state, learned confirmed rules, individually consented tools, and scheduled checks. Recorded real Super/Ultra calls on Nebius Token Factory have a substantive interpretation/proposal role. This is more than a renamed deterministic scheduler. The public synthetic action adapters and credential-free stored replay must remain visibly distinct from actual provider evidence. No fresh deployment availability or live model call was established in this review.

**Compliance: open; do not describe as submission-ready.** The round context explicitly leaves the updated public YouTube video and completed Devpost entry pending. Free, usable access through December 15 and sustainable inference allowances still need evidence. Public licensed source, English materials and significant-update copy exist in the reviewed repository, but I did not independently verify repository visibility, final track selection, provider-feedback submission, legal eligibility, or the final submitted artifact. These are separate from the scores.

## Scores

Internal 0–10 scale from the panel protocol; equal-weight mean **7.25/10**.

| Criterion | Score | Product/design assessment |
| --- | ---: | --- |
| Technological Implementation | 7.5 | Structured proposals, deterministic gates, approvals, durable ledger and explicit fresh read-back create a convincing explanation of safe execution. Recorded provider calls and separate Calendar/draft-only checks support substance. Owner-only enrollment, unfinished Hermes activation and limited live intake coverage constrain completeness. |
| Design | 7.0 | The student cascade is concrete; approval, correction, verification and evidence belong to a coherent product. Setup screenshots show restrained typography, clear permission cards, responsive stacking and useful disclosure. Dashboard error handling, availability claims and the long demo action/result path undermine trust and first-use completion. |
| Potential Impact | — | Students coordinating coursework, recruiting and team responsibilities face a specific dependency problem. The demonstrated exam-change cascade connects that problem to an approved, verified schedule repair. |
| Quality of the Idea | 8.0 | Repairing promises to people through typed dependencies, constrained model proposals and confirmed reusable corrections is distinctive. Ultra broadening repair options provides a credible reason for the chosen model. The weakest part is the incomplete visible experience of continuous monitoring and memory reuse beyond the scripted repair. |

## Highest-impact findings

### P1 — Availability and completed-integration claims exceed the owner pilot

The landing page says “always on,” “Always watching the sources you choose,” and that rules are mirrored for “your Hermes assistant” (`apps/web/app/page.tsx:8`, `:22`, `:33`). The secondary CTA is an unrestricted-looking “Sign in with Google” (`components/start-buttons.tsx:35`), whereas the configured pilot rejects other accounts (`services/orchestrator/src/google-auth.ts:140`; round context). Hermes is not enrolled or activated. The demo approval copy also states that on a phone “the same decision arrives as a Telegram button” without a connection condition (`components/demo-console.tsx:268`). These statements present implemented or separately measured capabilities as available personal service.

Submission materials compound the ambiguity: Devpost line 43 describes a persistent Nebius CPU backend and nightly backups, while line 53 describes Cloud Run/Neon and retired VMs. README and judge-checklist still call actual Google changes unverified despite the round context's controlled Calendar and Gmail draft evidence. Accurate limitations exist, but a reader must reconcile contradictions.

**Acceptance:** before OAuth, a non-owner can see that Google is an owner pilot and can reach the no-sign-in demo directly. Landing/approval copy conditions background checks and Telegram on enrollment, and labels Hermes activation pending. A single current capability/status description consistently distinguishes public real inference, simulated actions, actual synthetic Calendar verification, operator-provisioned Gmail draft-only verification, and separate OpenShell checks. Remove obsolete backend/backup claims. Do not imply inbox interpretation, actual sending, or completed Hermes deployment.

### P1 — Failed reads can look healthy or remain stuck indefinitely

Today converts non-OK approvals/workflow responses into zero approvals and an empty run list (`components/today-view.tsx:20–24`), then displays “Nothing to approve” and “No runs yet.” Network rejection has no catch. On Try, the initial refresh catch records `error`, but `phase` stays `loading`; the early loading return never renders that error (`components/demo-console.tsx:70`, `:143`). A backend outage can therefore appear as a healthy dashboard or an endless loading screen. This directly weakens confidence in a product users depend on to watch commitments.

**Acceptance:** failed approvals, workflows and initial demo-state requests show an accessible error with a retry action; failed data never renders as a verified empty state. Loading ends on both HTTP and network failure. Retain and label last known data if used. Verify each failure independently and recover without resetting an otherwise valid session.

### P1 — Editing only the email subject silently submits the original preset

The live composer permits subject edits (`components/demo-console.tsx:231`), but `edited` compares only `body` and `from` (`:74`). The trigger includes the edited email only when `edited` is true (`:108`). A judge changing only the subject sees one email and sends another. This also compromises interpretation experiments: the user cannot trust that the visible input reached Nemotron.

**Acceptance:** modify only the subject, deliver the email, and confirm the trigger payload and recorded interpretation source use exactly the displayed subject. Preserve the same behavior for sender-only, body-only and combined changes; fixture mode remains explicitly noneditable.

### P2 — Today does not answer “is Dira watching my sources?”

Today's subtitle promises “What Dira is watching” (`components/today-view.tsx:40`), but its cards show approvals and recent runs; there is no connector/check health, last successful source check or next expected check. Demo users cannot see the morning summary (`:60`), while the real-account empty summary delegates enablement to the operator (`components/morning-summary.tsx:37`) despite Setup linking users to automatic checks in Settings. A populated summary links to `#schedule-check` (`:54`), yet Today does not render that target. The always-on benefit is hard to inspect and one prominent next step can do nothing.

**Acceptance:** Today exposes each chosen source's enabled/paused/disconnected/error state and last successful check, with a next step for incomplete setup; show the scheduled cadence only when configured. The demo includes an explicitly simulated monitoring/summary state. Every morning-summary action navigates to a real schedule-check destination. A first-time user can tell within one screen whether any source is being monitored.

### P2 — The mobile demo puts a full week ahead of the first action and its result

The DOM renders the complete week before the email composer (`components/demo-console.tsx:185–245`); at widths below 860px the grid becomes one column (`app/globals.css:1936`). Results then render below both panels (`demo-console.tsx:248`), with an open flight record before verification (`:272–282`). There is no result focus or scroll handoff. This is a code-inferred discovery risk rather than a measured completion-time failure: a phone user has to traverse the week to act, then find the new status/approval below it. The documented under-three-minute judge path depends on discovering those controls quickly.

**Acceptance:** at 390px and desktop widths, provide a visible first-action cue and a direct way to reach the composer. After delivery, move accessible focus to the new status or offer an immediate result link; make a pending approval and verified outcome discoverable before a long raw trace. Keep the trace available through progressive disclosure. Observe a fresh visitor completing the default email → approval → verified outcome path within the documented three-minute target without coaching.

## Evidence and claim boundaries to preserve

The public Try disclosure, model-mode badge, session banner, simulated read-back description and explicit statement that OpenShell does not surround the Cloud Run broker are strong (`components/nav.tsx`, `demo-console.tsx:172–176`, `:282`, `:318`). Evidence also explicitly calls its data stored interpretations and stateful simulators (`app/evidence/page.tsx`). Keep these labels near the action/result they qualify. “0 HUMAN ACTIONS” on the reference Evidence story is only a property of its stored policy fixture; it should not be generalized to the interactive path, which requires approval.

The Setup screenshots support visual coherence and responsive permission controls; they do not demonstrate live account onboarding or recurring processing. The supplied actual Calendar source-change check and Gmail draft recovery check support those narrow provider claims only. The provider artifacts cover Calendar repair and draft recovery; the optional Hermes companion has a separate runtime setup.

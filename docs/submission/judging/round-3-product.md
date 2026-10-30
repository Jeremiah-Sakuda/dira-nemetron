# Round 3 — independent product/design review

> October 30 editorial correction: the internal Potential Impact score and aggregate mean are withdrawn. The assessment now follows the official problem, audience and demonstrated-solution criterion. Other numerical scores describe the original October 18 snapshot.

Reviewed October 18, 2026, source **`04520e1`**. Third and final internal judging round. Deployment IDs and current visual checks will be appended by the parent. These are internal scores, not official judgments or predictions.

## Basis, gate and compliance

Read repository guidance, panel protocol, round-3 context, current Try/Today/Setup/Evidence/Activity source, source-monitoring implementation, and the judge operating plan. Applied the UI/UX Pro Max feedback, navigation and error-recovery guidance already read in this review session. No sibling scorecards, browser operation, inference, tests or private runtime data were used. Historical Setup screenshots establish only their recorded layout; the current frontend has not been visually verified by this reviewer.

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules), rechecked during this review session, use a viability/track/API gate followed by four equally weighted criteria.

**Stage One: provisional pass on supplied evidence.** Dira is a genuine Personal AI attempt with private persistent commitments, confirmed reusable corrections, chosen tools and enrolled scheduled processing. Actual recorded NVIDIA Nemotron Super/Ultra calls through Nebius Token Factory have meaningful interpretation and repair-proposal roles. The public action adapters are simulated. Separate actual synthetic Calendar and operator-provisioned Gmail draft evidence support those narrow capabilities. The account memory restore/rule-reuse fixture strengthens persistence evidence, without establishing owner Hermes activation or daily user benefit.

**Submission compliance: open.** The revised public YouTube video, final Devpost entry and final submitted track/feedback are not established. Source includes English materials, license and significant-update explanation. The operating plan appropriately labels future daily checks and free hosting as planned/best effort; it does not prove access or live inference through December 15. Google publishing/reconnect remains owner-dependent; owner Hermes is incomplete. Neither is assumed complete or credited as a working judge dependency.

## Scores

Internal 0–10 scale; equally weighted mean **7.625/10**.

| Criterion | Score | Assessment |
| --- | ---: | --- |
| Technological Implementation | 8.0 | Structured proposals, deterministic authorization and durable verified execution form a substantial system. The supplied 23/23 actual PostgreSQL checks, restored-memory rule reuse and tightened Calendar execution guards strengthen implementation evidence. These are recorded checks, not tests run by this reviewer. Live account intake breadth, owner runtime activation and future operation remain bounded. |
| Design | 8.0 | The source now gives the main judge path recovery/recheck controls, result focus, short step links, collapsed trace, explicit owner access and a useful dated evidence index. Source health distinguishes scheduled configuration from proven delivery. Remaining issues affect evidence consistency and edge-case recovery; current visual and timed completion proof remains pending. |
| Potential Impact | — | Students coordinating coursework, recruiting and team responsibilities face a specific dependency problem. The demonstrated exam-change cascade connects that problem to an approved, verified schedule repair. |
| Quality of the Idea | 8.0 | Dependency-aware promise repair, bounded Nemotron proposals and confirmed reusable corrections remain a creative, coherent use of the technology. The new Ultra comparison explains its non-obvious role and preserves rejected-plan counts. More settings or tests do not alone establish a stronger idea or user outcome. |

## What is now clear in source

- Try clears failed surface reads and presents verification as unavailable, includes timestamps, refreshes allowance after trigger failures and offers a non-destructive availability check (`components/demo-console.tsx:66–74`, `:125–128`, `:196`, `:294–298`).
- The first-action link bypasses the full week, the result is focusable, and the long flight trace is collapsed (`demo-console.tsx:124`, `:199`, `:264`, `:287`). These improve the mobile information path; no uncoached three-minute completion was observed here.
- Today has a Source health card and unknown-state handling (`components/today-view.tsx:72–78`). Backend state says “scheduled” for configuration and explicitly disclaims current token validity/delivery proof (`services/orchestrator/src/account-monitoring.ts:24`). The demo truthfully says no real source is monitored.
- Current Evidence places dated live-model, actual Calendar, actual draft-only Gmail and separate sandbox/recovery artifacts ahead of the old replay (`app/evidence/page.tsx:38`, `components/current-evidence.tsx:4–9`). The Ultra comparison reports three accepted proposals and two wins, rather than treating all seven resolved cases as model wins.
- Google entry points now say owner pilot (`components/start-buttons.tsx:35`, `account-setup.tsx:155–159`); demo approval copy conditions Telegram delivery on linking (`demo-console.tsx:283`). Owner Hermes remains explicitly incomplete in current evidence.

## Remaining actionable findings

### 1. P1 — Activity can show the wrong run's evidence under the selected run

`components/activity-log.tsx:30–36` starts a new detail fetch when selection changes but does not clear `detail`, bind it to a workflow id, cancel the previous request or catch failures. Until the new response arrives, the newly active run can display the prior run's actions and flight record. A failed request leaves that mismatch indefinitely; rapid selection permits an older response to overwrite the newer selection. The initial network failure also leaves “No runs yet” (`:19–27`, `:40`). This is particularly damaging on an evidence surface.

**Acceptance:** select A then B while A is delayed, and fail B independently. Details must always be keyed to the selected workflow, with loading/unavailable states and retry. Ignore or cancel stale responses. A failed initial read must never be presented as an empty history. These are proposed validation checks, not executed checks.

### 2. P1 — A missing initial read-back baseline can become a post-repair baseline

Try lets state loading succeed while the first surface read fails (`components/demo-console.tsx:65–75`); delivery remains enabled. On the next successful refresh, `setBaseline(current => current ?? surfaceBody)` (`:72`) records whatever world exists then. If that success is after the repair, the comparison starts after the changes. `diffCalendar` consequently finds no change, despite the panel saying it compares with the start of the session (`:176`, `:298`). A normal reload of an already repaired session also initializes a new in-memory baseline at the current world. Fresh final reads alone do not establish the claimed before/after comparison.

**Acceptance:** preserve a versioned initial synthetic baseline in the session or have the server return the authoritative run comparison. If no starting baseline is available, label before/after comparison unavailable while still showing independently read final state. Exercise initial-surface failure → repair → successful retry and page reload after repair; neither may incorrectly claim the week was unchanged.

### 3. P2 — “Verify changes” can point to no section for the safety/no-change case

The third step link appears whenever `run` exists (`components/demo-console.tsx:199`). Its `#verify-title` target only exists on surface error or when a calendar/message/booking difference is present (`:294–297`). A new session that processes the injection email without changes can therefore show a verification link with no target. The page also misses the chance to explicitly show that no simulated external surface changed—the key result of that scenario.

**Acceptance:** whenever a run completes, render a reachable verification section with explicit no-change results as well as mutations, independent read time and comparison scope. Test injection-first, unrelated-email and normal-repair paths. Every displayed step link must have a rendered target.

### 4. P2 — Monitoring-only failure has no retry, and its action can lead demo users into owner setup

The new monitoring request has a separate error (`components/today-view.tsx:26`), but “Retry Today” only appears for the approvals/history error (`:53`). If those requests succeed and monitoring fails, the Source health card offers no recheck. Its sole action goes to `/onboarding?section=connections` even for demo users (`:78`), although demo navigation deliberately omits Setup and real connections are owner-only. The disclosure is honest; the recovery path is incomplete.

**Acceptance:** add a source-status retry independent of approvals/history. A monitoring-only failure can recover in place. Give demo users a relevant simulated-policy explanation or link, and reserve real-connection setup for the owner pilot. Paused/fenced source states should link to the setting that can change them, with enrollment-only states clearly identifying operator action.

## Residual limits for the final iteration

Preserve the current evidence labels and dated revision limits. Source fixes do not replace deployment checks; an updated narrated public video and a measured uncoached judge run remain useful completion evidence. Actual Calendar mutation does not prove all current concurrency changes against Google; draft creation/recovery does not prove inbox intake or sending. A restored rule fixture does not prove owner Hermes Skills activation. Use the current recording and operator access plan for the submission package.

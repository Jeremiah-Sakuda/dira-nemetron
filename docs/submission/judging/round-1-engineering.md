# Round 1 — independent engineering and reliability review

> October 30 editorial correction: the internal Potential Impact score and aggregate mean are withdrawn. The assessment now follows the official problem, audience and demonstrated-solution criterion. Other numerical scores describe the original October 18 snapshot.

Internal AI judging simulation, October 18, 2026. These scores use the panel's 0–10 calibration, not an official Devpost scale or prediction of winning. Reviewed source HEAD `efd6a262190df054285377b32ce987b73d939281`, matching the round snapshot; local guidance/report files are outside that commit. No implementation changes, tests, inference, private runtime reads or computer UI were used. Other reviewers' reports were not consulted.

## Basis and deployment boundary

Read the PRD, repository guidance, review protocol/context, README, Devpost draft, judge checklist, launch readiness, bounded model review, Calendar/Gmail evidence, migration evidence and selected execution, approval, quota, scheduler and web source.

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules), opened during this review, specify a viability/theme/API Stage One gate and four equally weighted Stage Two criteria. They separately require free project access through judging and submission materials. A source implementation and historical evidence do not establish the current deployed behavior.

The supplied context identifies frontend `dpl_6FZmNNUE2K4CeooC9xU8Ww2JuoRj` and backend `dira-nemetron-backend-00014-xtd`. October 16–17 evidence records earlier revisions. I could not independently observe the current public frontend: the web fetcher returned internal errors for both `/try` and `/evidence`, and local curl could not resolve the host. This is an observation limitation, **not evidence that the deployment is down**. Public interaction results should be supplied by the panel's browser review.

## Stage One and compliance

**Stage One: supported pass on the supplied evidence, with current live availability unconfirmed by this reviewer.** The commitment graph, durable private memory, owner-confirmed rules, scoped tools and scheduled processing form a genuine Personal AI attempt. Actual Super/Ultra calls on Nebius Token Factory and the overlap case demonstrate meaningful NVIDIA model use. Incomplete Hermes activation does not itself negate that fit. The credential-free replay is a useful fallback, but does not demonstrate a fresh required-provider runtime call.

**Submission compliance: incomplete.** Current context explicitly leaves the updated public YouTube video and final Devpost submission open. Stable free access through December 15 and Google token continuity are unresolved operating commitments. Google publishing approval, owner Hermes/MCP enrollment and final legal submission steps remain owner actions where applicable; they are not assumed complete. Provider-feedback material exists, but this review did not establish submission of it. No compliance pass is inferred from numerical scores.

## Scores

| Criterion | Score | Evidence and limit |
| --- | ---: | --- |
| Technological Implementation | 7.5 | Substantial typed proposal/compiler/policy/ledger/read-back architecture, recorded recovery and RLS checks, real model evaluations and actual Calendar/Gmail draft verification. Fresh-state gaps below and unfinished operating enrollment prevent a stronger score. |
| Design | 7.0 | A coherent source-change, approval, correction and activity journey is present in source and prior evidence. Conflicting readiness claims and the configured-versus-available model label weaken trust. Current rendering was not independently inspected here. |
| Potential Impact | — | Students coordinating coursework, recruiting and team responsibilities face a specific dependency problem. The demonstrated exam-change cascade connects that problem to an approved, verified schedule repair. |
| Quality of the Idea | 8.0 | Explicit dependencies and promise repair, bounded model proposals, reusable correction rules and independently verified effects are a thoughtful combination. Ultra repairs beyond the enumerator substantiate the idea; eleven proposals are still a narrow basis for generalization. |
| Equal-weight mean | — | Withdrawn with the earlier Impact assessment; no replacement numerical judging round was run. |

## Highest-impact findings

### E1 — Fresh-state revalidation can miss new conflicts and concurrent provider edits

**Priority: high. Criteria: Implementation, Impact.**

`services/orchestrator/src/account-approval.ts:71` iterates only stored graph commitments and rereads their individual provider events. It then solves over the rebased stored graph at line 99. A newly created external event occupying the approved destination is absent from both checks. `services/orchestrator/src/account-broker.ts:304` likewise checks the action's own event rather than the destination's full occupancy. Separately, `adapters/calendar/src/user-google-calendar.ts:128` reads an event then PATCHes it without an `If-Match` header; DELETE at line 147 has the same gap despite ETags already being available in metadata. An external edit between the fresh read and write can therefore be overwritten. Read-back confirms Dira's own effect, not that the concurrent change was respected.

**Action:** read a complete, paginated bounded Calendar occupancy window during approval/resume and reject or replan when an unreviewed busy event affects feasibility. Preserve intake review semantics: unknown events may conservatively block a slot without becoming confirmed commitments. Carry the checked ETag through mutations and handle provider precondition failure as stale state. Document the remaining non-atomic cross-event race explicitly.

**Acceptance check:** after planning, add an external busy event in the proposed destination without syncing Dira; approval/resume must make zero mutations and request review. Change the target event between preflight and PATCH/DELETE; the provider must reject the stale conditional write and preserve the external edit. Cover pagination and incomplete-read failure behavior. These are static-review findings, not reproduced test failures in this review.

### E2 — Live judge availability is bounded globally, but the UI advertises configuration as availability

**Priority: high. Criteria: Implementation, Design; related access compliance.**

`services/orchestrator/src/inference-budget.ts:12` uses one global durable scope with defaults of 100 lifetime, 20 rolling-day and 12 rolling-hour calls. The October 16 recorded flow consumed three calls and brought lifetime usage to 21. That leaves, at that recorded point, at most roughly 26 equivalent fresh flows before permanent exhaustion; current remaining usage is unknown. The daily allowance supports only about six equivalent flows. These are sensible spend controls, but do not establish access across the judging period.

`services/orchestrator/src/account-repair.ts:63` defines live solely by presence of a key. `/api/demo/state` at `account-routes.ts:99` returns that mode even when quota is exhausted, while `apps/web/components/demo-console.tsx:175` shows the green “Nemotron live” badge and does not render the returned quota summary. The guard eventually returns an error directing users to Evidence; there is no visible preflight paused status or direct fallback in that component.

**Action:** surface budget-aware availability separately from provider configuration, show a clear paused reason/reset time and a direct credential-free replay link before submission. Record an explicit judging-period operating plan, including allowance monitoring and who can restore service within approved spending limits. Do not erase durable usage or raise spending automatically to conceal the limit.

**Acceptance check:** with an exhausted hourly, daily or total budget, the first loaded demo state shows a paused state and an actionable Evidence link; it never presents a green live-available claim. Hourly/daily reset times are correct, total exhaustion has no false reset promise, and the fallback completes with zero model calls. Publish the dated operating plan and distinguish forecast capacity from measured availability.

### E3 — Owner connector and companion configuration

**Operator follow-up.** Keep Calendar/Gmail consent, scheduled connector opt-in and the optional Hermes companion scoped to the configured owner. Recorded Calendar repair, Gmail draft recovery and persistent-rule checks each retain their dated technical scope.

**Action:** complete owner-authorized connector or companion configuration through the normal consent flow. Validate the immutable Skills mirror before labeling that companion active. Keep account setup tasks in the operator tracker and the public judge journey independent of owner credentials.

**Acceptance:** the public demo and credential-free evidence remain accessible without Google login or a local Hermes runtime. Account-specific features describe their configured permissions and runtime accurately.

### E4 — Contradictory submission claims obscure the strongest completed evidence

**Priority: medium. Criteria: Design, Implementation credibility.**

`README.md:119` says actual Google APIs have never been exercised, and line 120 leaves Gmail verification open, although the Calendar and Gmail artifacts record actual provider checks. `docs/submission/judge-checklist.md:3` and line 28 repeat the older unverified claim. Conversely, `docs/submission/devpost.md:43` claims a persistent Nebius CPU backend and nightly backup, contradicted by its own current-deployment paragraph and `remaining-launch-work.md:26`, which says the VM backup job stopped. Line 55 asks for Google source-to-read-back work already partly completed. An evaluator should not need to resolve chronology to know which product exists.

**Action:** reconcile README, checklist and Devpost with one dated readiness summary. Describe Cloud Run/Neon hosting and actual Calendar/Gmail draft evidence accurately; preserve still-open inbox, sending, continuous sync, owner Hermes and ongoing recovery limitations. Keep historical evidence immutable and add explicit supersession links where useful.

**Acceptance check:** each judge-facing claim agrees on current hosting, backup coverage, real versus simulated action paths, tested versus untested Google flows and owner actions. Link current deployment identifiers and dated evidence. No current document claims a running Nebius VM or ongoing nightly backup after retirement.

## Evidence strengths worth preserving

The bounded model report distinguishes 7/7 resolved scenarios from only 3/11 acceptable Ultra proposals and two winning model repairs; that avoids attributing deterministic success to the model. Actual Gmail checks exposed provider rewriting of Message-ID and record recovery without duplication. Migration evidence separates semantic Git recovery from byte identity, and sandbox evidence expressly says OpenShell is outside the public broker. These are unusually useful engineering disclosures. Improvements should preserve these boundaries and the existing deterministic fallback.

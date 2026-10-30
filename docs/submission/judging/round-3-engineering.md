# Round 3 — independent engineering and reliability review

> October 30 editorial correction: the internal Potential Impact score and aggregate mean are withdrawn. The assessment now follows the official problem, audience and demonstrated-solution criterion. Other numerical scores describe the original October 18 snapshot.

Internal AI judging simulation, October 18, 2026. This is the third and final panel round. Scores are internal 0–10 calibration, not official scores or a winning prediction. Reviewed commit `04520e1398e0bfcb4ce2b81005e47e170356a08b`, protocol/context, iteration change log, availability plan, revised execution/receipt/occupancy/migration code, public evidence component and selected test source. No tests, inference, private runtime reads, browser UI or implementation edits were performed. No sibling scorecard was read.

## Stage One, compliance and evidence boundary

**Stage One: supported pass on supplied evidence.** This is a genuine Personal AI implementation with a durable private graph, confirmed correction rules, user-selected tools and meaningful Nemotron Super/Ultra use on Nebius Token Factory. The recorded model-only overlap repair gives a concrete contribution beyond a deterministic enumerator. The [official rules](https://nebiusglobalaihackathon.devpost.com/rules), reviewed in Round 1, separate this viability/API gate from equal-weight Stage Two scoring and submission compliance.

**Submission compliance: incomplete.** Revised narrated footage/public YouTube and final Devpost publication are pending. Google project-wide publishing/reconnect requires owner action; the owner Hermes gateway, token/turn and immutable Skills activation remain incomplete. Future free judge availability and credit coverage have a more specific operating plan but are not measured future uptime. Required feedback submission and final legal/eligibility actions are not attested by this review.

The context reports 152 credential-free tests, a separate **23/23 real PostgreSQL checks** under a non-superuser/NOBYPASSRLS role, root/web TypeScript success and a zero-advisory dependency check. These are credited as supplied measurements, not reruns by this reviewer. The PostgreSQL run exercises the real database under a restricted role and includes recovered-rule reuse.

Iteration 1 deployment/session creation is confirmed in the context. At review time, the new Vercel/backend deployment and exact-snapshot GitHub CI are in progress. No credit is given for their planned success. October 16–17 provider evidence and separate Linux sandbox enforcement retain their original revision/scope limits; they do not attest the revised broker against actual Google today.

## Scores

| Criterion | Score | Reason |
| --- | ---: | --- |
| Technological Implementation | 7.5 | Strong deterministic execution architecture, additional retry/receipt protections and actual restricted-role DB validation. The separate event-repair path still has the clock/read-back gaps below; full provider interruption and migration transition evidence remain limited. |
| Design | 7.5 | Evidence now explains live model contribution and dated actual-provider checks; Today distinguishes configuration/history from delivered monitoring; Try exposes unknown/retry states. Current revision's deployed presentation is not independently inspected here. |
| Potential Impact | — | Students coordinating coursework, recruiting and team responsibilities face a specific dependency problem. The demonstrated exam-change cascade connects that problem to an approved, verified schedule repair. |
| Quality of the Idea | 8.0 | Explicit dependency repair, bounded structured model proposals, persistent corrections and independent verification remain a thoughtful combination. The model comparison is clearer without overstating eleven proposals. |
| Equal-weight mean | — | Withdrawn with the earlier Impact assessment; no replacement numerical judging round was run. |

## Fixes credited

The Calendar-only broker now checks remaining absolute slots and freshly rebased feasibility before each mutation (`account-broker.ts:195–198`, `calendar-resume.ts:33`). Completed CREATEs are reconstructed with real provider identity; exact allowed-created identity/title/time is checked in occupancy. Typed recovery receipts resolve the logical-versus-provider ID ambiguity in the reviewed broker path. The non-destructive Try refresh and stale-surface handling address the prior quota/read-back presentation gaps.

Migration scripts are now hashed, serialized and transactionally recorded once (`postgres-store.ts:156–173`), avoiding repeated policy DDL on every normal startup. The reported concurrent PostgreSQL suite is relevant evidence for the observed CI deadlock. The documented non-atomic interval between occupancy read and a different Calendar event changing remains a real provider limitation, not an eliminated race.

## Prioritized residual findings

### E3.1 — Fresh-clock protections cover the Calendar-only broker, not the event-repair execution path

**High priority — Implementation, Impact.** `account-broker.ts:196` calls the new `assertRemainingCalendarPlanFresh`, but real Google event workflows use `resumeAccountRepair` (`services/orchestrator/src/account-repair.ts:91–107`) and `DiraOrchestrator`. `agents/dira/src/orchestrator.ts:687` updates `nowMin` at approval; line 715 validates stored actions directly against state, without rejecting absolute slots in the past or rebuilding action minute offsets after horizon rebasing. `prepareRuntime` rebases real-account state at `account-repair.ts:247–249`, while those persisted action `start_min` values are from the earlier horizon. Execution at `orchestrator.ts:427–428` also lacks the new per-mutation fresh-clock check. The real adapter wrapper at `account-tools.ts:132–134` checks occupancy, not whether an intended slot has passed. Crash recovery additionally restores the trigger-arrival clock at `orchestrator.ts:179`, rather than a current real-account clock.

**Action:** apply equivalent absolute-intent normalization and current-clock feasibility checks to every real Google execution path, including event-derived repairs, authenticated approval resumption, provider retries and crash recovery. Share the guard or explicitly disable the unguarded real-account mutation path until it is aligned. Preserve the deliberately simulated clock for demo/replay.

**Acceptance:** an actual/stubbed Google account event-repair plan waits for approval or suffers a transient/crash interruption; advance the real clock beyond its proposed CREATE/MOVE slot and resume through the normal event-repair API. No provider mutation may occur. Also rebase the horizon before a still-future approval: validation must use the same absolute instants that execution will send. Exercise this path, not only the Calendar-only helper.

### E3.2 — Event-repair Calendar read-back verifies start time but can accept the wrong duration/title

**High priority — Implementation.** `agents/dira/src/orchestrator.ts:964–976` verifies MOVE/CREATE by passing only ID and `startIso`, then treats any returned event as success. `GoogleUserCalendarTool.verifyEvent` (`adapters/calendar/src/user-google-calendar.ts:189–193`) applies those supplied filters but does not compare the approved end time. A CREATE can also have the wrong title. The event orchestrator then marks the action `VERIFIED` and applies the desired duration to its graph (`orchestrator.ts:466–480`). An external event with the expected start but a different end can therefore be counted as independently verified despite differing from the approved result. The Calendar-only broker's `matchesDesired` is stronger; the same invariant should hold in both paths.

**Action:** compare the full action-specific approved intent in the event verifier: provider/logical identity, start, end and title where the action defines one. Use exact provider identity for deterministic creates. Keep mismatches unverified and route them to safe review/replan without duplicating an uncertain CREATE.

**Acceptance:** a provider read returns the approved start but an incorrect end; MOVE and CREATE must remain unverified. A CREATE with mismatched title or wrong provider identity must also fail. Correct results must still reconcile after an interrupted write without duplication. Verify ledger state and graph contents through the complete event-repair path.

### E3.3 — Migration ledger coverage does not yet establish a safe upgrade of a populated legacy database

**Medium priority — Implementation/deployment evidence.** `postgres-store.ts:157–173` creates a new migration ledger and, when empty, replays all eighteen historical scripts. Those scripts include policy drops/recreation and primary-key replacement (`migrations/007_action_ledger_identity.sql:4–6`). This adoption path is materially different from the second tracked startup tested by `tests/postgres/migrations.test.ts:5–17`. The new test proves unchanged ledger timestamps after repeat initialization, but does not populate an old-schema database without the ledger or check a failure during adoption. This is a coverage gap, not a demonstrated data-loss defect; the reported DB suite should not be described as proving the transition.

**Action:** verify the first tracked startup against a disposable populated copy of the old schema. Preserve accounts, ledger/approval state, encrypted memory, tenant isolation and reference integrity; measure concurrent-start behavior. Check rollback and retry after a failed migration, and changed-hash refusal. Use a controlled cutover for the first adoption if old revision traffic can contend with DDL.

**Acceptance:** before/after semantic snapshots match for synthetic populated accounts and a pending approval; restricted-role cross-account reads remain denied. Concurrent initializers complete without deadlock or duplicate migration records. A deliberate script failure leaves neither its partial schema effects nor its migration record, and a subsequent corrected run succeeds. Link the exact-snapshot green GitHub PostgreSQL job and actual deployment confirmation separately from this local fixture evidence.

### E3.4 — Owner connector and companion configuration

**Operator follow-up.** Keep Calendar/Gmail consent, scheduled connector opt-in and the optional Hermes companion scoped to the configured owner. Recorded Calendar repair, Gmail draft recovery and persistent-rule checks each retain their dated technical scope.

**Action:** complete owner-authorized connector or companion configuration through the normal consent flow. Validate the immutable Skills mirror before labeling that companion active. Keep account setup tasks in the operator tracker and the public judge journey independent of owner credentials.

**Acceptance:** the public demo and credential-free evidence remain accessible without Google login or a local Hermes runtime. Account-specific features describe their configured permissions and runtime accurately.

## Final engineering assessment

The revised broker and database work are meaningful improvements. The highest remaining implementation priority is aligning the two execution paths so that the safety claims apply equally to Calendar-only plans and email/event-derived repairs. The evidence index and availability plan make limitations easier to evaluate; they should preserve the distinction between implemented safeguards, fixture measurements, historical provider checks, current deployment and future operational commitments.

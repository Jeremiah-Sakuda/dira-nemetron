# Round 2 — independent engineering and reliability review

Internal AI judging simulation, October 18, 2026. Scores use the panel's 0–10 calibration, not an official Devpost scale or prediction. Source reviewed: `e17b24a4bbbc056b7bc5dad416cd5fc69ca6e7e0`, matching the round snapshot. Read repository guidance, protocol/context, iteration change log, current submission/readiness material, Calendar/inference code and selected existing test source. No tests, inference, private runtime reads, browser UI or implementation mutations were performed. No sibling scorecard was read.

## Deployment, Stage One and compliance

The round context says deployment is in progress, with a source-only backend image digest `sha256:207f6c1dfc8765d33f51c3c7f16a8f717c95490a6e5d2e3b10bd7fd515a87a4f`. I credit the changes as source plus reported local validation, not as independently observed production behavior. The reported 145 passed checks and 22 PostgreSQL skips are recorded evidence, not checks I reran. The old actual Calendar/Gmail artifacts remain useful within their original synthetic-content and revision boundaries.

**Stage One: supported pass on supplied evidence; present deployment availability is not independently attested here.** The graph, private durable memory, confirmed rules and selected tools form a genuine Personal AI attempt. Actual Nemotron Super/Ultra calls on Nebius Token Factory and the model-only overlap repair establish meaningful required technology use. This uses the [official rules](https://nebiusglobalaihackathon.devpost.com/rules) checked in Round 1: the viability gate is distinct from the four equally weighted criteria and submission requirements.

**Submission compliance: incomplete.** The revised public video/YouTube publication and Devpost submission remain unfinished. Free judge access through December 15, allowance coverage and Google Testing continuity are unresolved. The publishing decision still needs owner approval; owner Hermes authentication, MCP enrollment and active Skills mirror are not complete. These are not inferred from successful sandbox fixtures. No claim is made that provider feedback has been submitted.

## Scores

| Criterion | Score | Reason |
| --- | ---: | --- |
| Technological Implementation | 7.5 | Pagination, occupancy checks and conditional provider writes materially strengthen the boundary. Residual retry and CREATE recovery issues below keep the engineering score at its previous level. |
| Design | 7.5 | Quota-aware labels, clear paused replay access, corrected submission claims, subject-only editing and explicit unknown/error states improve coherence in source. Current deployed rendering remains outside this review. |
| Potential Impact | 6.5 | The audience and cascade remain credible. No new independent user, longitudinal pilot or actual Gmail intake result establishes broader value. |
| Quality of the Idea | 8.0 | Bounded proposals and persistent promise repair remain distinctive; the demonstrated model-only repair supports the idea. New safety work strengthens implementation more than novelty. |
| Equal-weight mean | **7.375** | Internal calibration only. |

## Prioritized actionable findings

### E2.1 — Transient and partially completed retries bypass fresh time-based feasibility

**High priority — Implementation, Impact.** `services/orchestrator/src/account-broker.ts:59–83` reruns approval validation only when no evidence exists or every record is `AUTHORIZED`/`PENDING_EXECUTION`. A persisted `FAILED_TRANSIENT` record or a partial plan with `VERIFIED` records makes `noActionStarted` false. The retry can then reuse arbitrarily old evidence. The subsequent checks compare graph/profile versions, policy and source times; none recomputes feasibility at the new current time. Occupancy reads begin at the current time but do not reject an action whose desired start is already past. `/api/approvals/resume` remains reachable at `main.ts:610`.

**Action:** revalidate the remaining approved intents at every resume, using a fresh clock and state reconstructed from verified actions. Do not regenerate completed effects or discard authenticated approval; reject stale remaining timing/feasibility and request a new plan where necessary. Keep uncertain outcomes eligible for read-back recovery.

**Acceptance:** plan a future move/create, persist a transient provider failure, advance time past the proposed slot, and resume with unchanged graph/profile. No provider mutation may occur. Repeat after one sibling action has verified; completed effects remain intact and only a freshly feasible remainder can execute. This is a static-review finding, not a reproduced failure.

### E2.2 — Created-event exemptions skip validation of their actual busy times

**High priority — Implementation.** `calendar-occupancy.ts:18–30` permits any event whose logical ID appears in `allowedCreatedIds`; its time comparison only applies when a reviewed commitment can be resolved by provider ID. The broker passes **all** CREATE idempotency keys at `account-broker.ts:196–197`. Its reconstructed state uses `applyAction` at line 195, but `packages/constraint-engine/src/apply.ts:24` creates a commitment without an `externalId`. A verified event created earlier in the same plan can therefore be externally moved into a later action's destination and still pass occupancy validation: its ID is exempt, and there is no matching reviewed provider ID to compare. This is a specific validation omission beyond the documented unavoidable race after a final read.

**Action:** reconstruct created commitments using verified provider receipts, and validate allowed-created entries against exact approved or verified intent, including time and identity. Limit exemptions to the relevant current/verified action and fail closed on a mismatched event.

**Acceptance:** execute the first CREATE of a multi-action plan, externally move that event into the next action's destination, then resume. The next mutation must be blocked, with the changed event preserved. Also check a matching prior CREATE can resume normally and a pending CREATE ID cannot exempt an unrelated busy effect.

### E2.3 — Interrupted CREATE recovery can persist the logical ID as the Google source ID

**High priority — Implementation.** Recovery at `account-broker.ts:95–106` writes `fresh.observed` into `externalResponse` for an `EXECUTING` action. A `CalendarEvent` from `adapters/calendar/src/user-google-calendar.ts:26` has `id = extendedProperties.private.diraId` when present, while its real provider ID is in `metadata.googleEventId`. `postgres-store.ts:901–907` prefers `externalResponse.id` over that metadata, so a recovered CREATE can be committed as `cal-<idempotencyKey>` with the wrong `externalId`. `graphReflectsVerifiedActions` at `account-broker.ts:275–279` repeats the same preference. Future provider GETs use `google:<externalId>` and will target the wrong resource.

**Action:** normalize Calendar execution/recovery receipts into a typed shape with distinct logical and provider IDs. Use the provider ID for graph external references and validate it against independently read metadata. Avoid applying one precedence rule to two different response shapes.

**Acceptance:** crash after an actual/stubbed CREATE succeeds but before the ledger stores its response; restart from `EXECUTING`. Recovery must verify without duplication, persist the real Google event ID, and successfully reread/move that same event through the normal adapter. Check the alternate crash after the response is already persisted.

### E2.4 — A paused demo does not refresh availability when its displayed reset arrives

**Medium priority — Design, Implementation.** The revised quota summary and guarded send button are useful. However, `apps/web/components/demo-console.tsx:72` loads state once; later refreshes happen after mutations/approval callbacks. A ready paused state at line 185 has no availability refresh action or timer, and the send button stays disabled at line 245 after its advertised reset. A failed send at lines 118–120 also leaves the prior availability snapshot unchanged. Browser reload works, but the screen does not tell the user that it is necessary. The shared lifetime allowance and judging-period operating plan remain open; this UI change does not add capacity.

**Action:** provide a non-destructive availability refresh and/or schedule a bounded refresh at the reset, including after quota failures and tab refocus. Preserve the current run and inputs. Keep total exhaustion explicitly operator-controlled and do not increase spend automatically.

**Acceptance:** load a quota-paused ready demo, advance past the reset without reloading/resetting the session, and use the refresh or automatic check. Delivery becomes available only after a successful server check; the run and draft remain intact. A quota failure updates the paused label and replay link. Document who monitors judge-period availability and the approved recovery action.

### E2.5 — The operating Personal AI loop is still not demonstrated as one persistent owner workflow

**High submission priority — Design, Impact; Implementation evidence.** `README.md:47` still leaves actual scheduled Google enrollment pending and line 50 leaves the revised automatic Skills mirror unvalidated. Round 2 context explicitly records no owner MCP token, model turn, scheduled workflow or owner Skills activation, plus unresolved Google Testing continuity. Existing Calendar source-to-read-back and Gmail draft-only checks are real but separate; Gmail intake and longitudinal reuse remain unproved. No amount of additional mock coverage establishes those observations.

**Action:** retain precise pilot boundaries and complete a bounded synthetic-content owner pilot where existing authorization permits. Record scheduled detection, approval, actual read-back and later confirmed-rule reuse after restart. Validate the immutable mirror before claiming an active Hermes path. Where owner authentication/publishing is required, leave that exact action open rather than bypassing it.

**Acceptance:** one dated evidence chain identifies scheduled delivery, opted-in connector intake, zero preapproval effects, authenticated approval, actual provider read-back and rule reuse after recovery. If this cannot be completed, the submission must clearly present a restricted pilot and distinguish implemented, measured, deployed and pending behavior. The public credential-free fallback must remain independently usable.

## Improvements credited and remaining uncertainty

The reviewed source addresses the first round's missing pagination and direct target-write race: incomplete bounded reads fail closed, ETags protect PATCH/DELETE, cancelled/not-found events are absent, and unknown events no longer grant graph authority. Existing tests cover those helpers and the wrapper; they do not establish the complete broker interruption scenarios above. The cross-event interval between a final occupancy read and provider mutation remains non-atomic and is honestly documented in the iteration log. Submission documents now describe Cloud Run/Neon and actual provider checks more consistently. Scores deliberately retain the gaps in current deployment proof, real owner operation and user outcomes.

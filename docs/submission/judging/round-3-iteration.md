# Iteration after round 3 — October 18, 2026

Engineering and product changes following internal review round 3. The October 30 editorial correction withdraws the earlier internal Impact score and aggregate mean; see [the review summary](summary.md).

## Changes from final review

- Real-account event repairs now use an execution-time clock and the remaining-plan/policy guard before each external mutation. Relative action offsets derive from approved absolute instants on resume, recovery and graph commit; demo/replay retain their simulated clocks. Calendar read-back checks end time and approved title, and the real adapter checks logical/provider identity. The event path and Calendar-only path share current-clock feasibility protections.
- Activity clears details on selection, keys them to the selected workflow, ignores stale responses, distinguishes failure/loading/empty states and offers retry. Try compares current reads to the server's explicitly versioned published fixture calendar, avoiding a post-repair in-memory baseline mislabeled as the session start. Every completed/no-change run has a verification target. Monitoring errors can retry in place; demo users link to simulated policies.
- The public evidence index pins historical artifacts to a source snapshot and links the recovered-rule verdict check. README prepares updates as drafts by default. The inherited zero-intervention replay metric is labeled V1 and contrasted with v2's authenticated approval requirement.
- Populated legacy migration adoption and injected-failure rollback were checked in a separate disposable database; no production/user data was used. See `docs/evidence/2026-10-18-legacy-migration.json`.

## Measured validation

**157 tests passed**, 23 database checks skipped in the credential-free suite; separately **23/23 PostgreSQL checks passed** on PostgreSQL16 with a non-superuser/NOBYPASSRLS runtime role. Root and web TypeScript passed. Five new full-orchestrator checks cover incorrect created title/end, incorrect moved end, normalization across rebasing and an expired approved real-clock plan making zero mutations. This is stubbed execution evidence, not a fresh Google provider validation of every new branch. Cross-event Calendar reads/writes remain non-atomic.

GitHub CI on preceding iteration `04520e1` passed all ten jobs ([39172075199](https://github.com/Jeremiah-Sakuda/dira-nemetron/actions/runs/39172075199)). Final-snapshot CI/deployment/browser results will be added after publication. Iteration2 production is frontend `dpl_67wNcPpinmA2emz7FWyptXkA5XQ1`, backend `00016-s9r`, full dependency image `sha256:8c1a4b0496590e0b7b768cc542d65de9cdbc0542ac4b37d34fde601050df2c93`.

## Operator follow-up

The recovered ASK_FIRST proof measures a policy verdict, not owner Hermes operation. Google publishing/reconnect remains owner-dependent. The local official Hermes gateway did not pass its bridge probe; no owner token/turn or active immutable Skills mirror is claimed. Revised footage, public YouTube and final Devpost confirmation are tracked separately until completed. Future free hosting/live inference through December15 is an operating obligation, not observed uptime.

## Final deployed walkthrough follow-up

The first post-iteration live synthetic run exposed a further proposal-shape flaw: Ultra used a Calendar MOVE for a MOVE_WITHIN_WINDOW interview without a BOOK step. The old per-action policy accepted the offered-slot provenance, so the run mirrored the stale offered time without triggering the booking adapter's 409. This was simulated only, with no real contact/provider mutation. It is not used as a successful counterparty-recovery claim in the revised video.

The final follow-up rejects that model shape in the compiler, denies an unmatched calendar mirror at plan policy, and requires a matching VERIFIED booking plus fresh booking read at execution/read-back. Deterministic booking→calendar plans retain their normal path. Two regression checks cover model/raw-plan bypasses; the entire credential-free suite now passes **159** checks (23 database checks run separately). The public scenario is rerun before footage is accepted. This is part of the final verification/iteration, not a fourth scored panel.


## Final observed outcome

The corrected public walkthrough passed on backend `00018-w55` / source `070e1df`, frontend `dpl_Azc7sKTGz5tvdxaXJ2tZfyW3769x` / source `8165d69`. Zero simulated calendar/message effects preceded authenticated approval. The stale first booking failed409; the later offered time was booked/read back, all13 actions verified, final slack78min. A subsequent hostile email produced NO_ACTION_NEEDED with unchanged independent surface reads. The application egress probe returned an audited403. [Exact model/fallback and deployment evidence](../../evidence/2026-10-18-final-judge-path.json).

CI [39172973527](https://github.com/Jeremiah-Sakuda/dira-nemetron/actions/runs/39172973527) passed all ten jobs on that follow-up. The new local 2:26 narrated video/captions and upload-ready materials are complete; public YouTube/Devpost publication awaits unlocked signed-in Chrome and any action-time owner/security/legal steps. Google project publishing still needs the owner's decision. The optional owner Hermes companion has separate runtime configuration.

Hosting follow-up: Vercel's default selected Node24 for the final package build despite CI/backend using Node22. Root/web engines and lock metadata are now pinned to `22.x`; dry-run clean-install consistency and web typechecking passed. This prevents an unreviewed major runtime change during judging. The revised video uses the settled two-run Today history; narration/captions remain2:26.

A final real-account review also normalized persisted action offsets before the execution-time policy comparison. Otherwise a still-future recruiter-approved absolute slot could be incorrectly denied after the solver horizon rebased. The added regression demonstrates unchanged absolute intent and an ALLOW verdict after normalization. The credential-free suite now passes160 checks; the previously measured separate PostgreSQL suite remains23/23. This correction preserves stale-slot rejection and does not grant new authority.

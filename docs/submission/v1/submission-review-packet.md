# Dira — submission review packet

This is the single review document for the Devpost submission and final demo recording. Replace the bracketed video URL only after the final upload. Keep the evidence language precise.

---

# Part 1 — Devpost submission

## Submission fields

- **Project name:** Dira
- **Tagline:** When one commitment changes, Dira repairs the plan.
- **Track:** The Taskmaster
- **Project URL:** https://dira-phi.vercel.app
- **Repository:** https://github.com/Jeremiah-Sakuda/Dira
- **Demo video:** `[PUBLIC YOUTUBE / VIMEO URL]`
- **Architecture diagram:** https://github.com/Jeremiah-Sakuda/Dira/blob/main/docs/architecture/dira-production.svg

## Inspiration

A professor moved a midterm forward by two days. That one change collided with a recruiting interview, erased study capacity, and made a team deliverable impossible to finish in its allowed window. Calendar and task apps showed every conflict—in red—and then asked me to repair the week manually.

That is the problem Dira solves. The hard part is not remembering commitments; it is recomputing everything else that becomes infeasible when the outside world moves. Dira treats a schedule change as a trigger to repair the plan, not as another notification.

![A midterm moves, three commitments become infeasible, and Dira restores a verified plan](https://raw.githubusercontent.com/Jeremiah-Sakuda/Dira/main/docs/submission/problem-to-repair.svg)

**One thing changes. Everything adapts.** Dira finds what no longer fits, chooses only permitted repairs, and verifies the resulting world before it calls the plan repaired.

## What it does

Dira is an autonomous commitment-repair agent: when an authorized external change makes a student's week infeasible, it finds the downstream conflicts and repairs the plan without requiring the student to manually coordinate every change. Under the hood, it updates a typed graph of commitments and dependencies, computes feasibility as Global Slack, and takes only policy-authorized actions.

In the 48-Hour Shock demo, a professor moves a midterm from Friday to Wednesday. Dira detects the mutation, finds six affected commitments and three violations, evaluates repair candidates, and acts without human intervention after the trigger. It tries an authorized interview slot, receives a deliberately seeded stale-listing `409`, refreshes state, replans, books the remaining authorized slot, delegates visual QA to its designated backup, rebuilds the study plan, and independently verifies each mutation. Global Slack moves from `+4.1h` to `−3.6h` to `+1.3h`.

The demo includes counterfactuals: when no approved interview slots remain, Dira stops safely instead of inventing success; when the constraint changes, the action set changes.

After each run, Dira presents a **proof-carrying repair receipt**: a compact, plain-English account of what was protected and changed, any action failure it recovered from, the rejected alternatives, and the independent re-reads that verified the resulting state.

## How we built it

- **Gemini 3.5 Flash on Vertex AI**, through the Google GenAI SDK, interprets schedule-change language and resolves entities behind strict schemas.
- A **typed commitment graph** represents commitments, time windows, flexibility, stakeholders, provenance, and executable edges including `REQUIRES_PREPARATION`, `REQUIRES_BUFFER`, and `DELEGATABLE_TO`.
- Deterministic engines own propagation, Global Slack, planning, and policy. Gemini never performs schedule arithmetic, authorizes a tool, or declares success.
- A Firestore-backed **action ledger** persists intent before execution, uses idempotency keys and transactional claims, and separates execution from verification.
- Every mutation is verified by re-reading its target; an optimistic tool response never becomes internal truth by itself.
- The deployed boundary is one **Cloud Run** service using Vertex AI, Firestore, and a real service-account-managed **Google Calendar**. The Next.js judge console is hosted on Vercel and labels each run `LIVE CLOUD`, `DETERMINISTIC EVIDENCE`, or `CLOUD UNAVAILABLE`.
- An optional, separately deployed **Gemma 3n** Cloud Run service transcribes short user voice notes. It returns only text and has no tool credentials; its transcript is untrusted and owner-scoped before entering the same Dira safety pipeline. Mention it as live only after end-to-end evidence is included in the demo; call it GPU-backed only if a GPU revision is actually deployed.

## What makes it autonomous instead of a chatbot

The user does not prompt Dira through each repair. A change enters the system, then Dira propagates the impact, derives candidate plans from current state, selects only policy- and provenance-approved actions, survives partial failure, and verifies the resulting world state. It stops when authorization or availability is insufficient.

**Models interpret. Engines decide. Ledgers remember. Verifiers believe.**

## Evidence boundary

The live-cloud demo uses Gemini on Vertex AI, Cloud Run, Firestore, and real Google Calendar mutations with independent verification reads. Recruiter availability/booking, organization-task ownership, and the notification outbox are deliberately labeled **controlled Firestore integrations**. The outbox is not presented as consumer Gmail delivery; the demo trigger is not presented as a live Gmail Watch/Pub/Sub integration.

The repository also includes a credential-free deterministic replay, an eight-scenario variation matrix, property/chaos tests, and 20 consecutive replays with zero duplicate mutations and zero policy violations. Those prove the engine separately from the live-cloud side effects.

## Challenges we ran into

The difficult part was not producing a plan—it was ensuring the plan could act safely when the world changed mid-execution. A booking can fail after the planner reads availability, and a worker can stop after a tool succeeds but before it records success. Dira therefore persists intent before execution, re-reads external state after every write, invalidates failed options, and replans from the new world state.

We also treated email-like inputs as hostile. Model outputs must pass a strict schema, resolve to an existing commitment, satisfy sender authority, meet a confidence threshold, carry action provenance, and pass deterministic policy. No untrusted text or model output can widen the agent's authority.

## Accomplishments that we're proud of

- A full autonomous repair loop with a visible `409 → OBSERVE → REPLAN → VERIFY → RESOLVED` recovery sequence.
- Deterministic authority boundaries: the model can interpret, never authorize.
- A durable action ledger, idempotent execution, independent verification, and crash-resume coverage.
- 77 tests across unit, integration, property, replay, and chaos suites.
- A credential-free canonical replay with 18/18 assertions, eight runtime variations, and 20/20 injected-failure recovery runs.
- A judge-controlled dashboard that honestly distinguishes live cloud from deterministic evidence.
- A proof-carrying repair receipt that turns a run's diff, recovery, candidate rationale, and verification evidence into an auditable user outcome.

## What we learned

Autonomy is earned by the unglamorous parts: explicit permissions, provenance, idempotency keys, fresh verification reads, failure handling, and a visible safe-stop condition. The LLM is valuable where language is ambiguous; the agent's authority and correctness should remain falsifiable.

## What's next

We will add Gmail OAuth/Workspace delivery, LMS and production recruiting connectors, multi-user negotiation, and a longer-horizon commitment model. Gemma 3n voice intake is implemented as an optional private capture path; the next step is to collect end-to-end deployment evidence and add a photo-based official-notice workflow with the same gates.

## Built with

TypeScript · Google GenAI SDK · Gemini 3.5 Flash · Vertex AI · Cloud Run · Firestore · Google Calendar API · Next.js · Vercel · Zod · fast-check · Vitest

---

# Part 2 — final demo video

**Superseded:** the single authoritative recording script now lives at
[`docs/demo/video-script.md`](../demo/video-script.md). It merges this
packet's flow (proof-carrying repair receipt, counterfactual run) with the
timed Cloud Logging workflow-ID shot, the raw `.run.app` health-check beat,
and a hard re-record gate (uncut segment > ~110s → re-record). Record from
that file only.

# Final Devpost submission: Dira

Complete the bracketed URLs before publishing. Do not replace an evidence
boundary with a stronger claim than the final video proves.

## Submission fields

- **Project name:** Dira
- **Tagline:** When one commitment changes, Dira repairs the plan.
- **Track:** The Taskmaster
- **Project URL:** `https://dira-phi.vercel.app`
- **Repository:** `https://github.com/Jeremiah-Sakuda/Dira`
- **Demo video:** `[PUBLIC YOUTUBE OR VIMEO URL]`
- **Architecture diagram:**
  `https://github.com/Jeremiah-Sakuda/Dira/blob/main/docs/architecture/dira-production.svg`

## Inspiration

A professor moved my midterm forward by two days. That one email collided
with a recruiting interview, wiped out my study time, and made a club
deliverable impossible to finish in its window. Every app I owned showed me
the damage in red and then waited for me to fix it by hand.

I built Dira because the hard part of a busy week was never remembering what
I had to do. The hard part is recomputing everything else that breaks when
one thing moves, and then actually doing something about it.

![A midterm moves, three commitments become infeasible, and Dira restores a verified plan](https://raw.githubusercontent.com/Jeremiah-Sakuda/Dira/main/docs/submission/problem-to-repair.svg)

**One thing changes. Everything adapts.**

## What it does

Dira is an autonomous commitment-repair agent. When an authorized external
change makes your week infeasible, Dira finds every downstream conflict,
chooses repairs it is actually permitted to make, executes them, and then
verifies the world really changed before calling the week repaired. You do
not prompt it through any of this.

The canonical demo is the 48-Hour Shock. A professor moves a midterm from
Friday to Wednesday. Dira extracts the change, walks its commitment graph,
and finds six affected commitments and three hard violations. Its
feasibility measure, Global Slack, falls from +4.1 hours to negative 3.6:
the week no longer fits. Dira then acts. It books the approved interview
slot and hits a 409 because that listing was seeded stale. It refuses to
pretend the booking worked, refreshes availability, rules the slot out,
replans, and books the other approved slot. It delegates visual QA to the
one teammate a stored graph edge designates, reclaims two flexible personal
blocks, rebuilds the study plan on a real Google Calendar, and re-reads
every system it touched. Global Slack ends at +1.3 hours. Zero human
actions after the trigger.

The demo also shows what Dira refuses to do. Remove every approved
interview slot and it stops safely with an explanation instead of inventing
an appointment. Change the world and the plan changes with it, because the
plan is derived, not scripted.

Every run ends with a proof-carrying repair receipt: what was protected,
what changed, the failure it recovered from, why the losing repair options
were rejected, and the independent re-reads that verified the result. Most
agents hand you an answer. Dira hands you the evidence.

## How we built it

- **Gemini 3.5 Flash on Vertex AI**, through the Google GenAI SDK,
  interprets schedule-change language and resolves entities behind strict
  schemas. It reads language. It cannot authorize actions.
- A **typed commitment graph** stores commitments, time windows,
  flexibility, stakeholders, provenance, and executable edges such as
  `REQUIRES_PREPARATION`, `REQUIRES_BUFFER`, and `DELEGATABLE_TO`.
- **Deterministic engines** own propagation, Global Slack, planning, and
  policy. Gemini never performs schedule arithmetic and never declares
  success.
- A Firestore-backed **action ledger** persists intent before execution,
  uses idempotency keys and transactional claims, and keeps execution
  separate from verification, so a crash or a retry can never double-book.
- **Every mutation is verified by re-reading its target.** An optimistic
  tool response never becomes internal truth on its own.
- The deployed boundary is one **Cloud Run** service using Vertex AI,
  Firestore, and a real service-account-managed **Google Calendar**. The
  Next.js judge console on Vercel labels each run `LIVE CLOUD`,
  `DETERMINISTIC EVIDENCE`, or `CLOUD UNAVAILABLE`, so you always know what
  you are looking at.
- A separately deployed **Gemma 3n** Cloud Run service (CPU,
  `google/gemma-3n-E2B-it`) transcribes short spoken voice notes. It
  returns only text and holds no tool credentials; its transcript is
  treated as untrusted input and owner-scoped before it enters the same
  pipeline as every other trigger. One real spoken note has been run end to
  end against the deployed stack, from audio through transcription, Gemini
  interpretation, repair, and verification to RESOLVED, captured in
  `docs/evidence/gemma-voice-run.json`.

## What makes it autonomous instead of a chatbot

A change enters the system and Dira does the rest: propagates the impact,
derives candidate plans from the current world, selects only policy- and
provenance-approved actions, survives partial failure, and verifies the
resulting state. When authorization or availability runs out, it stops and
says so.

Models interpret. Deterministic code decides.

## Evidence boundary

The live-cloud demo uses Gemini on Vertex AI, Cloud Run, Firestore, and
real Google Calendar mutations with independent verification reads.
Recruiter availability, organization-task ownership, and the notification
outbox are deliberately labeled **controlled Firestore integrations**. The
outbox is not presented as consumer Gmail delivery, and the demo trigger is
not presented as a live Gmail Watch/Pub/Sub integration.

The repository also carries a credential-free deterministic replay, an
eight-scenario variation matrix, property and chaos tests, and 20
consecutive replays with zero duplicate mutations and zero policy
violations. Those prove the engine separately from the live side effects.

## Challenges we ran into

Producing a plan was never the hard part. Acting on one safely while the
world keeps moving is. A booking can fail after the planner reads
availability. A worker can die after a tool succeeds but before the success
is recorded. Dira answers with a specific discipline: persist intent before
executing, re-read external state after every write, invalidate failed
options, and replan from the world as it is now, not as the plan assumed.

We also treated email-like input as hostile. A mutation must pass a strict
schema, resolve to an existing commitment, satisfy sender authority, clear
a confidence threshold, carry provenance for each proposed action, and pass
deterministic policy. No untrusted text and no model output can widen the
agent's authority.

## Accomplishments that we're proud of

- A full autonomous repair loop with a visible recovery sequence:
  `409 → OBSERVE → REPLAN → VERIFY → RESOLVED`.
- Deterministic authority boundaries. The model can interpret and never
  authorize.
- A durable action ledger, idempotent execution, independent verification,
  and crash-resume coverage.
- 77 tests across unit, integration, property, replay, and chaos suites.
- A credential-free canonical replay with 18/18 assertions, eight runtime
  variations, and 20/20 injected-failure recovery runs.
- A judge-controlled dashboard that honestly distinguishes live cloud from
  deterministic evidence.
- A proof-carrying repair receipt that turns a run's diff, recovery,
  candidate rationale, and verification evidence into something a user can
  audit.

## What we learned

Autonomy is earned by unglamorous work: explicit permissions, provenance,
idempotency keys, fresh verification reads, failure handling, and a visible
safe stop. The model is valuable exactly where language is ambiguous. The
agent's authority and correctness should stay falsifiable everywhere else.

## What's next

Gmail OAuth and Workspace delivery, LMS and production recruiting
connectors, multi-user negotiation, and a longer-horizon commitment model.
Gemma 3n voice intake is deployed and evidenced end to end
(`docs/evidence/gemma-voice-run.json`); the next step is a photo-based
official-notice workflow through the same gates.

## Built with

TypeScript · Google GenAI SDK · Gemini 3.5 Flash · Vertex AI · Cloud Run ·
Firestore · Google Calendar API · Gemma 3n · Next.js · Vercel · Zod ·
fast-check · Vitest

## Submission checklist

- [ ] Replace the demo URL with the final **public**, English video.
- [ ] Confirm the video visibly shows `LIVE CLOUD`, Cloud Run/Vertex
      evidence, a real Calendar before/after, the 409 replan, and the final
      verification.
- [ ] Confirm the hosted app and repository open in a signed-out browser.
- [ ] Attach the architecture diagram and select **The Taskmaster**.
- [ ] Add only actually published article/social links; include the
      required hackathon wording and `#AllThingsAgenticHackathon` where
      applicable.

# Dira

> **Dira v2 is under active implementation on `dira-v2/personal-ai`.** The v1 deterministic evidence path remains available while the live model path moves to Nebius Token Factory and the account, broker, and connector layers are built. See [`AGENTS.md`](AGENTS.md) for the official judging criteria and [`docs/product/DIRA_V2_IMPLEMENTATION_PLAN.md`](docs/product/DIRA_V2_IMPLEMENTATION_PLAN.md) for delivery stages and release gates.

**Dira continuously detects changes to your commitments, propagates their
consequences across your life, and autonomously takes the actions required to
make your plans feasible again.**

*One thing changes. Everything adapts.*

[![ci](https://github.com/Jeremiah-Sakuda/dira-nemetron/actions/workflows/ci.yml/badge.svg)](https://github.com/Jeremiah-Sakuda/dira-nemetron/actions/workflows/ci.yml)
&nbsp;**Interactive evidence:** [dira-phi.vercel.app](https://dira-phi.vercel.app)
— choose a scenario and stream a fresh run. The page labels the active
boundary as live cloud, deterministic evidence, or unavailable.

---

## The problem

Every calendar assumes the future stays still. It doesn't. Exams move,
interviews change, deadlines compress, responsibilities collide. The hard part
of being a student balancing classes, recruiting, and organizations isn't
remembering what you have to do — it's figuring out **what everything else
breaks when one commitment changes**. Today's tools surface the conflict.
They don't repair it.

Dira models commitments, not tasks: outcomes with time requirements,
dependencies, stakeholders, flexibility, delegatability, and policies
governing what an agent may do about them — stored as a typed graph. When the
outside world moves, Dira repairs the graph.

## The 48-Hour Shock

The canonical workflow. A professor emails: *Midterm 2 moves from Friday 2 PM
to Wednesday 2 PM.* No one prompts Dira. It then, autonomously:

1. **receives** the email event (demo: an authorized webhook carrying the professor email; Gmail Watch → Pub/Sub is a scripted seam, not exercised) and extracts a structured mutation (Nemotron via Nebius Token Factory, then strict schema validation)
2. **propagates** consequences over typed edges — 6 commitments affected
3. **computes** feasibility: Global Slack +4.1h → **−3.6h**, three violations
4. **plans** 6 candidate repairs; deterministic validation + explicit cost function
5. **acts**: books the recruiter-approved Thu 10 AM slot → **409, slot gone**
6. **observes** refreshed availability, **replans**, books Thu 1 PM → verified
7. **delegates** sponsor-deck QA to the designated backup (and tells her why)
8. **reclaims** two personal blocks, **rebuilds** the study plan on the calendar
9. **verifies** every mutation against external state, recomputes: **+1.3h, RESOLVED**

Zero user interventions. One injected failure, recovered. In deterministic
mode four stateful adapter surfaces are mutated and independently verified;
in production the Calendar mutations target a real Google Calendar while the
other three remain controlled Firestore surfaces.

```
FEASIBILITY  Global slack +4.1h → -3.6h; 3 violation(s)
PLAN         6 candidate repair(s) evaluated
ACTION       Book "TechCorp technical interview" at Thu 10:00
ERROR        409 SLOT_NO_LONGER_AVAILABLE
OBSERVE      External state refreshed after failure
REPLAN       Re-evaluating remaining repair options
ACTION       Book "TechCorp technical interview" at Thu 13:00
VERIFY       Verified: Book "TechCorp technical interview"
RESOLVED     Feasibility restored — global slack +1.3h
```
*(elided excerpt — run `make demo-replay` for the full timestamped recording)*

## Run it yourself — no credentials, one command

```bash
npm install
make demo-replay        # the full 48-Hour Shock, injected 409 included → 18/18 assertions
make demo-variations    # 8 runtime variations, each repair derived from state
make replay-20x         # reliability evidence: 20/20 consecutive passes
make test               # unit + integration + property + chaos suites
```

## Judge quick-start — one minute to the proof

1. Open the [interactive evidence](https://dira-phi.vercel.app) and select
   **48-Hour Shock**. Confirm its runtime badge before running it: only a
   `LIVE CLOUD` label substantiates live Google side effects; a
   `DETERMINISTIC EVIDENCE` label is reproducible engine evidence.
2. Run the scenario and look for the decisive sequence:
   `ERROR 409 → OBSERVE → REPLAN → VERIFY → RESOLVED`. The selected repair is
   derived from the current world rather than a scenario ID.
3. Inspect the **What actually changed** table: it shows before/after state
   and the verification method for each mutation. The canonical outcome
   restores Global Slack from −3.6h to +1.3h without a human action.
4. Select **No slots available**. Dira must stop safely rather than invent an
   appointment. Select **Alternate task owner** to confirm the stored graph
   edge, not a prompt, determines who receives the delegation.
5. For credential-free verification, run `make demo-replay` (18 assertions),
   then `make replay-20x`. A short captioned evidence walkthrough is generated
   with `make demo-video`; it is labeled deterministic and is not a substitute
   for the final live-cloud recording.

## Evidence manifest

Every headline claim, with where a judge can see it proven:

| Claim | Judge-visible proof |
| --- | --- |
| v1 Gemini on Vertex AI (historical inference evidence) | `docs/evidence/gemini-live-eval.json` (8/8, `vertexai: true`, per-case latency); retained as v1 evidence, not the v2 runtime |
| v2 Nemotron via Nebius Token Factory | `npm run eval:nemotron` writes `docs/evidence/nemotron-eval.json`; each run records model, per-case latency and token usage. A live API key is required. |
| Real Google Calendar actions | Live run's before/after table + the moved events on the shared demo calendar · [`adapters/calendar/src/google-calendar.ts`](adapters/calendar/src/google-calendar.ts) |
| Replanning after a 409 | Live flight recorder (`ERROR → OBSERVE → REPLAN → ACTION → VERIFY`) · [`docs/evidence/production-run.json`](docs/evidence/production-run.json) |
| Crash-safe execution | `tests/chaos/*` + the CI `chaos-tests` job |
| 10/10 production reliability | [`docs/evidence/production-10x.json`](docs/evidence/production-10x.json) |
| 20/20 deterministic reliability | CI `golden-replay-20x` artifact |
| v1 prompt-injection & forged-sender safety evidence | `docs/evidence/gemini-live-eval.json` (blocked cases) · `tests/integration/interpretation-pipeline.test.ts`; Nemotron must pass the same deterministic gates |
| Authorization is deterministic, not model-driven | Each `POLICY` flight line names the rule and the stored fact that authorized it · [`packages/policy-engine`](packages/policy-engine) |

## What makes Dira different

- **It repairs, it doesn't remind.** The deliverable is restored feasibility,
  not a notification.
- **The model proposes; deterministic code disposes.** Nemotron does semantic
  interpretation and entity resolution. Time arithmetic, slack, constraint
  checks, policy, and feasibility are deterministic and property-tested. A
  model output can never authorize an action.
- **Actions need provenance.** An interview can move to Thu 1 PM because a
  stored recruiter message offers it; QA can go to Maya because a
  DELEGATABLE_TO edge says so. No provenance → DENY, unconditionally.
- **External truth wins.** Every mutation is verified by re-reading the
  external system. Tool success responses are never trusted alone.
- **It survives skepticism by construction:** runtime variation, randomized
  property tests, chaos tests, crash-resume, and one-command replay.

## Architecture

![Dira production architecture](docs/architecture/dira-production.svg)

The v1 production boundary is one Cloud Run service. The v2 branch routes
live interpretation to Nemotron through Token Factory; deterministic engines own propagation,
feasibility, planning, and policy; a Firestore action ledger coordinates
execution and independent verification. Google Calendar is the real external
mutation target. Recruiter availability, organization ownership, and outbound
notifications are clearly labeled controlled Firestore integration surfaces.
Account isolation, Postgres, the broker, and Nebius-hosted scheduling are planned migration stages; the current service still uses the v1 Firestore integration boundary.
The Vercel dashboard proxies authenticated judge actions without exposing its
token. [Architecture details and evidence legend](docs/architecture/README.md).

The personal-account v2 foundation now includes Google OAuth with PKCE,
signed HttpOnly sessions, encrypted credential storage, Postgres RLS, and a
read-only Google Calendar preview on `/onboarding`. Sign-in creates an
account-scoped, timezone-aware empty commitment state. On an explicit user
action, Nemotron Nano prepares drafts from upcoming event titles and times;
each draft must be edited or confirmed before it enters the graph. After two
commitments are confirmed, Nemotron Ultra can suggest typed links, which also
require user confirmation before they affect propagation. Ownership and
delegation links are excluded without explicit person evidence. Users can set
their recurring focus hours and run an account-private feasibility check with
the deterministic solver and policy engine; candidate repairs are previews
and cannot mutate services. A feasible candidate with policy-held actions can
be sent to the per-account approval inbox. Approval re-reads relevant Calendar
items and reruns feasibility and policy. After every required approval, the
out-of-model broker revalidates, checks policy again, runs authorized Calendar
actions only when the account separately grants event-write scope, verifies
each result with a fresh Calendar read, and commits verified changes to the
account graph. The ledger and deterministic Calendar identifiers support
recovery after interrupted writes. Gmail and non-Calendar actions are not
connected to this account broker yet. It remains separate from the shared
synthetic judge world. The hosted dashboard does not yet have these
Google/Postgres secrets configured.

The Policies page now includes account-specific approval rules and a primary
Google Calendar fence. The fence blocks future Calendar reads, graph-proposal
access/generation/confirmation, approval revalidation, broker reads/writes,
and new Calendar repair requests; each request checks current policy before
token retrieval or Calendar access.
Previously confirmed Calendar facts stay stored but are excluded from schedule
checks while fenced; turning the fence off makes them available again.
Attempts blocked by policy appear in the account audit list. Users can
require approval before flexible-calendar moves, study-block restructuring,
or delegation that the deterministic baseline would otherwise permit. These
settings only add friction: they cannot turn a denial into permission, and
the same versioned settings are checked during approval and again in the
broker. The onboarding screen supports authenticated Git memory export and
restore for the confirmed graph, focus hours, and supported policy settings.
Calendar changes can be synced on demand and reviewed as graph proposals. The
five-minute background Calendar poller is opt-in, defaults off, and only runs
for account ids configured on the trusted orchestrator host; primary-calendar
fences take precedence. It uses per-account sync cursors and keeps those
cursors unchanged if proposal processing fails.
Deployments must configure `DIRA_CALENDAR_SYNC_ACCOUNT_IDS` on the orchestrator
to enable background checks for specific accounts; `DIRA_CALENDAR_POLL_INTERVAL_MS`
can adjust the interval from one minute to one hour (default five minutes).
Gmail read-only consent can be granted separately from Calendar access, but
Gmail message retrieval and automatic intake remain unimplemented. Gmail/person
fences, OpenShell egress controls, and imported correction rules remain
unimplemented.

Monorepo map: engines in [`packages/`](packages), the agent loop in
[`agents/dira`](agents/dira), scoped tool adapters in [`adapters/`](adapters),
the Cloud Run service in [`services/`](services), the golden fixture in
[`fixtures/`](fixtures), the dashboard in [`apps/web`](apps/web).

## The commitment model & graph

A `Commitment` carries schedule/effort fields, flexibility
(`FIXED | MOVE_WITHIN_WINDOW | FLEXIBLE | DELEGATABLE | OPTIONAL`),
criticality, ownership, and provenance. Typed edges are stored data the
engines execute: `REQUIRES_PREPARATION` derives prep deadlines,
`REQUIRES_BUFFER` carries the 3h post-exam recovery constraint,
`MUST_FOLLOW`/`MUST_PRECEDE` bound execution windows, `DELEGATABLE_TO` bounds
who a planner may propose, `SHARES_RESOURCE_WITH` links capacity competitors.

## Consequence propagation

A deterministic BFS from the mutated node over relevant typed edges. Each
edge rule compares constraint status before/after (both computed by the
solver) and emits an inspectable impact record:

```json
{
  "source_commitment": "econ402-midterm-2",
  "affected_commitment": "technical-interview-1",
  "edge_type": "REQUIRES_BUFFER",
  "constraint": "180 min buffer (POST_EXAM_RECOVERY_BUFFER)",
  "previous_status": "NOT_APPLICABLE",
  "new_status": "VIOLATED"
}
```

Cycle-safe; risk propagates transitively through dependency chains (broken QA
→ deck freeze → sponsor presentation). Details: [`docs/algorithms/propagation.md`](docs/algorithms/propagation.md).

## Global Slack is a real number

Global Slack = the minimum safety margin across all capacity buckets
(cumulative earliest-deadline test: usable capacity before each deadline minus
required work due by it) and applicable buffer constraints. Aggregate free
time can never mask one impossible deadline. The +4.1h → −3.6h → +1.3h
trajectory is **derived** from the fixture calendar by the solver and pinned
by tests — including §18's exact −216 minutes. Full formalism and the
derivation: [`docs/algorithms/global-slack.md`](docs/algorithms/global-slack.md).

## The autonomous repair loop

Candidate plans are generated from state (violations, live slot availability,
movable blocks, delegation edges), validated deterministically, priced by an
explicit cost function (critical drop 10 000 · opportunity 2 000 · social 500
· major move 100 · minor move 25 · action 5), policy-gated, persisted to a
durable action ledger with idempotency keys, executed through narrow
adapters, and independently verified before the internal world model is
allowed to believe them.

## Failure recovery

The taxonomy from PRD §28, exercised by chaos tests: transient 500s retry
with bounded backoff; permanent 409s invalidate the option and force a
replan against refreshed external state; malformed model output is rejected
by schema and retried; low confidence stops safely in WAITING_REVIEW;
verification mismatches never corrupt internal state; a killed process is
resumed by a fresh worker from the ledger without duplicating a single
external mutation.

## Security & policy boundaries

Emails are untrusted input. Interpretation is schema-gated; entity resolution
is structural; a **sender-authority check** means a random address cannot
mutate your interview no matter how well-formed the extraction; policy and
provenance gates run after all of that. Prompt-injection fixtures are part of
the eval corpus. More: [`docs/security/README.md`](docs/security/README.md).

## Deploy your own

```bash
export DIRA_PROJECT=<your-gcp-project> DIRA_SHARE_CALENDAR_WITH=<your-google-account>
bash infrastructure/cloud-run/provision.sh     # APIs, Firestore, AR repo, SA, secret
DIRA_ALLOWED_ORIGIN=<your-dashboard-origin> bash infrastructure/cloud-run/deploy.sh
# dashboard: set DIRA_CLOUD_RUN_URL + DIRA_DEMO_TOKEN as server-side Vercel env
# vars (vercel env add ...), then: vercel deploy --prod
# seed + smoke-test: POST /demo/reset then /demo/trigger with the demo token
```

For the personal-account preview, configure `DATABASE_URL`,
`DIRA_SESSION_SECRET`, `DIRA_TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `DIRA_WEB_ORIGIN` in the
orchestrator environment. The Google OAuth redirect must exactly match
`https://<dashboard-origin>/api/auth/google/callback`; enable the Google
Calendar API and allow the app origin. Use a dedicated non-superuser Postgres
role so forced row-level security remains effective. Keep these values in a
secret manager, not in `NEXT_PUBLIC_*` variables.

## Local replay & modes

`REPLAY_MODE=deterministic` (default) — stored interpretation fixtures, local
stateful adapters, zero credentials. `REPLAY_MODE=live-model` — Nemotron
interprets through Nebius Token Factory (`NEBIUS_API_KEY`), while tools stay
local. `REPLAY_MODE=production` — Nemotron through Token Factory, Firestore
persistence and transactional ledger, a real managed Google Calendar, and controlled
Firestore recruiter/org/outbox surfaces. See [`.env.example`](.env.example)
and [`infrastructure/cloud-run/`](infrastructure/cloud-run/).

## Testing & reliability evidence

- 77 passing tests across unit, integration, **property-based invariants over randomized
  graphs** (PRD §41 — monotonicity of slack, provenance completeness, policy
  soundness, ranking soundness), and chaos.
- `golden-replay-20x` CI job: 20 consecutive deterministic replays with the
  injected 409 → artifact published (`20/20 passed · 0 duplicate mutations ·
  0 policy violations · 20 failures recovered`).
- An 8-way runtime-variation matrix (exam time, slot outages, block
  durations, backup owner, prior progress, pre-trigger calendar shifts) —
  every repair derived, not replayed. Notably: with the exam at 1 PM the
  buffer holds and Dira correctly *doesn't* touch the interview.

## Current and legacy infrastructure

The v2 live model client calls Nebius Token Factory's OpenAI-compatible
`/v1/chat/completions` endpoint and captures provider, model, latency, and token
usage. Configure `NEBIUS_API_KEY` and `DIRA_NEMOTRON_MODEL`. The current service
deployment still uses Cloud Run and Firestore while later v2 stages replace
those boundaries. The Google Calendar adapter remains the real mutation target
and independently re-reads events to verify changes. Pub/Sub provisioning
remains an optional ingestion path, not a claimed live dependency. The dashboard deploys through Vercel. See
[`DEVIATIONS.md`](DEVIATIONS.md) for exact evidence boundaries.

### Optional Gemma 3n private voice intake

Dira also contains a separately deployable **Gemma 3n** audio intake service.
It transcribes a short, user-recorded voice note in a dedicated Cloud Run
service and returns only text to Dira; it holds no Calendar or tool
credentials. The transcript re-enters as an untrusted `gemma_voice_note` event
and must pass the same strict schema, owner restriction, confidence, provenance,
policy, ledger, and verification gates as any other trigger. This deployment is
optional and is **not** claimed as live until its Cloud Run service is enabled
and demonstrated. [Deployment details](infrastructure/gemma-voice/README.md).

## Setup

```bash
git clone https://github.com/Jeremiah-Sakuda/dira-nemetron && cd dira-nemetron
npm install            # Node ≥ 20
make demo-replay       # credential-free golden workflow
npm --workspace apps/web run dev   # dashboard on :3000
```

## Known limitations

- The production deployment is live (project `dira-agentic-2026`, Cloud Run
  `dira-orchestrator`; evidence in [docs/evidence/](docs/evidence/)). It is a
  single shared demo world sized for one run at a time; the service
  serializes concurrent judge runs rather than sharding worlds per viewer.
- Verified-mutation counts vary with the plan the solver derives for the
  seeded world (13 in the deterministic reference, 10 in the captured
  production run); both clear the PRD's ≥4 bar and every mutation is
  independently verified before it counts.
- Gmail delivery is a Firestore outbox rather than a consumer Gmail send.
  Recruiter and organization systems are controlled Firestore integrations,
  clearly labeled in the UI and architecture.
- Feasibility computes over the whole horizon; the planner clips repairs to
  "now", but already-elapsed free time still counts toward reported slack
  until events are re-anchored — a known modeling simplification.
- Recruiter scheduling and the org task tracker are controlled test doubles
  (PRD §46), clearly labeled — not claimed third-party integrations.
- The optional Gemma 3n voice-note service is deployed separately from the
  core repair loop. In `dira-agentic-2026` it currently uses an 8-vCPU/32-GiB
  CPU Cloud Run fallback because L4 quota is unavailable; it is only presented
  as live after a successful end-to-end recording, and must not be called
  GPU-backed until a GPU revision is actually deployed.
- One user, one week horizon, single-timezone fixture. Multi-user and
  long-horizon planning are P2.

## Hackathon disclosure

Built for the Google All Things Agentic Hackathon (Taskmaster track), newly
created within the submission window. Synthetic identities throughout
(Prof. Elena Chen, recruiter Jordan Lee, teammate Maya Okafor). Development
used AI coding assistance (Claude Code) under the author's direction, per
the contest's tooling-disclosure rule; open-source dependencies (TypeScript,
Next.js, zod, fast-check, Vitest, googleapis, @google-cloud/firestore,
@google/genai) are used under their licenses. Deviations from the product
spec are logged with justifications in [`DEVIATIONS.md`](DEVIATIONS.md).

## Design notes

The strongest version of Dira is not the one with the most features — it's
the one that survives skepticism. *Was that scripted?* Run the variation
matrix. *Is the feasibility number real?* Read the solver and its property
tests. *What if the tool lies or the process dies?* Read the ledger, the
verifier, and the crash-resume chaos test. *Can I run it?* One command, no
credentials.

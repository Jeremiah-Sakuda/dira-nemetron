# I built an agent that repairs my week when a professor breaks it

*Built for the Google All Things Agentic Hackathon, Taskmaster track.
#AllThingsAgenticHackathon*

A professor once moved my midterm forward by two days. One email. That email
collided with a recruiting interview, wiped out most of my study time, and
made a club deliverable impossible to finish inside its allowed window. My
calendar showed me every conflict in red. Then it waited for me to fix the
week by hand.

I kept thinking about how backwards that is. The hard part of a busy week is
not remembering what you committed to. The hard part is recomputing
everything else that breaks when one thing moves, and then doing something
about it. So for this hackathon I built Dira, an autonomous agent whose
whole job is that second part.

Dira: when one commitment changes, it repairs the plan.

- Live demo: https://dira-phi.vercel.app
- Code: https://github.com/Jeremiah-Sakuda/Dira
- Video: [PUBLIC VIDEO URL]

## What a repair actually looks like

The canonical scenario is what I call the 48-Hour Shock. A professor emails
that the midterm moves from Friday 2 PM to Wednesday 2 PM. Nobody prompts
the agent. From that trigger, Dira:

1. Extracts a structured schedule mutation from the email with Gemini 3.5
   Flash on Vertex AI, behind a strict schema.
2. Pushes the change through a typed graph of commitments and dependencies
   and finds six affected commitments, three of them now in violation.
3. Recomputes feasibility as a single number, Global Slack, which falls
   from +4.1 hours to negative 3.6. The week literally does not fit
   anymore, and Dira can prove it.
4. Plans repairs, but only from actions it is authorized to take: an
   interview slot the recruiter actually offered, a delegation edge that
   actually exists in the graph, personal blocks actually marked flexible.
5. Books the first approved interview slot and gets a 409, because that
   listing was seeded stale on purpose. It does not pretend the call
   worked. It refreshes availability, rules the slot out, replans, and
   books the other approved slot.
6. Delegates the club deliverable's visual QA to the one teammate a stored
   DELEGATABLE_TO edge designates, reclaims two flexible personal blocks,
   and rebuilds the study plan on a real Google Calendar.
7. Re-reads every system it touched to confirm the world actually changed,
   then declares the week repaired at +1.3 hours of slack.

Zero human actions after the trigger. And if you remove every approved
interview slot, Dira stops safely and tells you why, instead of inventing
an appointment. The plan is derived from the world it finds, not scripted.

## The design rule that made it work

Models interpret. Deterministic code decides.

Gemini is genuinely good at the part software has always been bad at:
reading a rambling human email and turning it into "ECON 402 Midterm 2,
new start Wednesday 14:00." It is the wrong tool for everything after
that. So in Dira, the model never does schedule arithmetic, never
authorizes an action, and never declares success. Propagation, slack,
planning, and policy are deterministic, property-tested TypeScript. A
model output physically cannot widen the agent's authority: every proposed
action must carry provenance (a stored fact that authorizes it), and no
provenance means DENY, unconditionally.

The other rule: external truth wins. Every mutation is verified by
re-reading its target system. A tool call returning 200 is a claim, not a
fact.

## The unglamorous parts were the whole project

Getting an agent to produce a plausible plan took a weekend. Getting it to
act safely while the world moves took the rest of the project, and this is
where most of the interesting engineering lives:

- **Intent before execution.** Every planned action is persisted to a
  Firestore ledger with an idempotency key before anything runs. A crash
  or a retry can never double-book an interview.
- **Transactional claims.** Moving an action from pending to executing is
  a compare-and-set, so redelivery cannot duplicate work.
- **Failure as information.** The 409 path is not error handling bolted
  on. Observing a failed action, refreshing the world, and replanning is
  the same loop as the happy path, which is why the demo can show it live
  without staging.
- **Hostile input by default.** An email-shaped trigger has to pass a
  schema, resolve to a real commitment, satisfy sender authority, clear a
  confidence threshold, and pass deterministic policy before anything
  happens.

The repo backs this with 77 tests across unit, integration, property,
replay, and chaos suites, a credential-free replay of the full scenario
(18 assertions), and 20 consecutive replays with zero duplicate mutations.

## Voice notes through Gemma 3n

Late in the project I added a second intake path: a separately deployed
Cloud Run service running Gemma 3n (google/gemma-3n-E2B-it, on CPU) that
transcribes short spoken voice notes. It returns only text and holds no
credentials for anything. The transcript is treated as untrusted input,
scoped to the note's owner, and pushed through the exact same gates as an
email. I recorded a real note about the midterm moving, posted the audio,
and watched it come out the other end as a fully repaired, verified week.
The captured run lives in the repo's evidence directory.

## What surprised me

Honesty turned out to be a feature. The dashboard labels every run as live
cloud or deterministic evidence, the demo's controlled integrations are
labeled as controlled, and the repair receipt at the end of a run shows
what changed, what failed, why the losing options lost, and what was
re-read to verify. I originally added all that for the judges. But it is
also what I would want from any agent acting on my life: not just an
answer, but the evidence that the answer is true.

One thing changes. Everything adapts.

*Dira was built solo for the Google All Things Agentic Hackathon using
Gemini 3.5 Flash on Vertex AI, Cloud Run, Firestore, the Google Calendar
API, and Gemma 3n. #AllThingsAgenticHackathon*

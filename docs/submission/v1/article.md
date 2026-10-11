# Repairing plans, not listing tasks: the engineering inside Dira

*Technical article draft (Stage Three, PRD §58). Publish to a blog/dev.to and
link from the Devpost submission for bonus points.*

## The coordination problem

Humans don't primarily have a task-management problem; they have a
coordination problem. A task is an isolated unit of work. A commitment has an
expected outcome, time requirements, a deadline, dependencies, external
stakeholders, flexibility, consequences of failure — and, if an agent is
involved, policies about what that agent may do to it. When one commitment
mutates, the damage is rarely local. The interesting system is the one that
repairs the damage.

This article walks through the five pieces of Dira that made autonomous
repair trustworthy: the typed graph, formal slack, state-derived planning,
the durable ledger, and verification.

## 1. A graph you can execute

Dira stores commitments as nodes and constraints as typed edges —
`REQUIRES_PREPARATION`, `REQUIRES_BUFFER`, `MUST_PRECEDE`, `DELEGATABLE_TO`,
`SHARES_RESOURCE_WITH`. The point of typing is that every edge has an
executable rule. Propagation is a deterministic BFS: apply each edge's rule,
compare constraint status before and after the mutation, emit an inspectable
impact record, continue through anything that changed. When a professor moves
an exam, the traversal reaches the interview (buffer), the prep pool
(deadline collapse), the problem set (shared capacity), and — through a
dependency chain — a sponsor presentation two hops away.

## 2. Slack as a theorem, not a vibe

"You're overcommitted" is only useful if it's falsifiable. Dira computes
Global Slack with a cumulative earliest-deadline test: for every hard
deadline, usable capacity before it minus work due by it; the global number
is the minimum across those buckets and any applicable buffer constraints.
Capacity is honest — every distinct work session pays a context-switch
overhead, windowed tasks consume their owner's time, and a "study block" is
transparent (it reserves pool capacity rather than double-counting it).
Property-based tests pin the monotonicity laws: earlier deadlines never
increase slack, added capacity never decreases it, added effort never
increases it.

## 3. Plans derived from state

The planner never sees a scenario id. It sees violations, live slot
availability, movable blocks, and delegation edges, and enumerates candidate
repairs: slot choices from recruiter-approved options, capacity donors by
subset, delegation when a window is infeasible for its owner, a study-plan
rebuild wherever the solver actually found the hours. Candidates are
validated by simulation, priced by an explicit cost function, and filtered by
a margin rule (never repair onto a knife edge). Move the exam to 1 PM instead
of 2 PM and the buffer holds — so the correct plan touches the blocks and
leaves the interview alone. That's the difference between replaying and
deriving.

## 4. The ledger is the agent's spine

Between "the plan says book Thursday 1 PM" and "Thursday 1 PM is booked"
lives every distributed-systems failure you've ever met. Dira persists every
intent to an action ledger before execution, with an idempotency key built
from workflow, action type, target, and desired state. Executors claim
actions, check whether the desired external state already exists, execute,
and mark `EXECUTED_UNVERIFIED` — never `VERIFIED`. Transient failures retry
with bounded backoff; permanent ones (a 409 on a stolen slot) invalidate the
plan and force replanning against refreshed reality. Our favorite chaos test
kills the process after the recruiter confirms but before the ledger records
it; a fresh worker reconciles by reading the recruiter's state and finishes
the workflow without double-booking.

## 5. Only the verifier gets to say "done"

Tools lie: timeouts after success, eventual consistency, optimistic SDKs.
Dira's internal world model updates only after an independent read of the
external system confirms the change. A lying calendar adapter in the chaos
suite proves the property: the workflow either recovers another way or stops
safely — it never believes its own wishes.

## Where the model fits

Gemini does what deterministic code can't: reading "we're doing the second
midterm Wednesday 2pm rather than Friday" and producing a structured mutation
with a confidence and a quotable evidence span. Everything after that —
arithmetic, feasibility, authority, execution, verification — is code. Strict
schemas, structural entity resolution, and a sender-authority gate mean a
prompt-injection email can at most be classified; it cannot act.

That division of labor is, we think, the general shape of trustworthy agents:
**models interpret; engines decide; ledgers remember; verifiers believe.**

---

*Dira was built for the Google All Things Agentic Hackathon. The golden
workflow — including its injected failure — reproduces with one command and
no credentials: `make demo-replay`.*

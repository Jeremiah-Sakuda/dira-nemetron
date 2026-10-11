# Dira

**Dira tracks what you have promised and to whom. When an upstream change breaks one of those promises, it repairs your week within limits you set, and tells the affected person before they have to ask.**

Personal AI entry for the Nebius × NVIDIA Global AI Hackathon. NVIDIA Nemotron models on Nebius Token Factory propose; deterministic code decides what runs.

[![ci](https://github.com/Jeremiah-Sakuda/dira-nemetron/actions/workflows/ci.yml/badge.svg)](https://github.com/Jeremiah-Sakuda/dira-nemetron/actions/workflows/ci.yml)

---

## The problem

Students and early-career professionals owe things to other people, and their weeks depend on dates they don't control. What they drop is rarely a forgotten task. It is a promise that broke because something upstream moved, and they found out when the other person asked.

A professor moves a midterm from Friday to Wednesday. The interview that afternoon now violates the recovery buffer. The study hours no longer fit, and a teammate is waiting on deck QA that can't happen. A calendar shows the overlap. Dira finds the whole cascade, plans a repair, asks before anything sensitive, does the work, and reads each change back to make sure it happened.

## Try it

**No sign-in:** open the hosted app, choose **Try the demo**, and send the sample professor email. In under three minutes you see:

1. The cascade, with global slack dropping from +4.1h to −3.6h.
2. Nemotron Ultra's structured repair proposal next to the deterministic candidates.
3. A labeled adversarial proposal, rejected because it cites a message that doesn't exist and mails an outside address.
4. Policy pausing a delegation for your approval.
5. A recovered booking conflict (HTTP 409 on the first slot).
6. Every change verified by a fresh read of the simulated calendar and mailbox.

You can also correct a step ("not at that time") and watch the confirmed rule shape the replan. Then send the prompt-injection email and see that nothing changes and nothing is sent.

The demo is a synthetic student with a simulated calendar, mailbox and counterparty, isolated per session by row-level security and deleted after four hours. It cannot contact anyone real. Without a Nebius key it runs on stored interpretations and says so on screen. With a key, Super and Ultra run live.

**Your own account:** sign in with Google. Grant Calendar, then Gmail, then drafting, one scope at a time. Confirm the graph Nemotron proposes, including who has authority and how much effort things take. From then on, a change from a person you named reaches the same repair path.

**From a terminal:**

```bash
npm install
make demo-replay        # the engine's golden workflow: 18/18 assertions, credential-free
make test               # unit, integration, property and chaos suites
make eval-repair-fixture  # the repair-proposer gates on stored proposals (no inference)
```

## How it fits the Personal AI track

| Track ask | What Dira does |
| --- | --- |
| Always on | Five-minute Gmail and Calendar polling, thirty-minute deadline feeds, a 02:00 recompute and a 07:00 summary per account. Runs on an always-on Nebius VM; the daily pass can also run as a Nebius Serverless Job. |
| Private | Postgres row-level security per account. Credentials stay in the broker, outside any model sandbox. Each account's Hermes runs in an OpenShell sandbox with default-deny egress, and the broker enforces its own allowlist with an audited 403. Draft-only by default. Calendar, Gmail and person fences. Export or delete everything. |
| Persistent memory | Each account's graph, focus hours, policy and rules are committed to a private Git repository. You can download it as a bundle and restore it with validation. |
| Reusable skills | When you correct Dira, it proposes a rule. Confirmed rules shape every later plan, and they are mirrored as read-only Hermes Skills (`skills/dira/<rule>/SKILL.md`). |
| Tools you choose | Each connector is its own consent: Calendar read, Calendar write, Gmail read, Gmail drafting. Deadline feeds you add. Official pages you name for Tavily checks. Telegram approvals you link. Hermes, through a token you create. |

## Nemotron on Nebius Token Factory

Each job uses the smallest tier that does it well. Every call records its model, tier, latency and tokens in the flight record, and the routing cost report is computed from that telemetry.

| Job | Tier | Output, and what checks it |
| --- | --- | --- |
| Commitment drafts from calendar, email and feed items | Nano | A strict draft schema. Email drafts need a verbatim evidence quote. Nothing enters the graph until you confirm it. |
| How an email changes an existing commitment | Super | The interpretation schema, then entity resolution against stored ids, commitment-scoped sender authority, and a confidence floor. |
| Typed links between commitments | Ultra | Validated against your graph; inert until confirmed. |
| Checking an official page (via Tavily search) for a changed date | Super | Tavily searches only the domain the owner named. A page's claim must quote the fetched text verbatim, then passes the same gates as an email. A web source is never contactable. |
| Repair plans | Ultra | Structured intents that cite typed provenance (`edge:…`, `slot:…`, `message:…`, `policy:…`, `rule:…`). A deterministic compiler resolves every reference and derives times, recipients and message text from stored facts. It then runs the same feasibility, margin, cost and policy checks as the enumerated candidates. |

Ultra matters because the enumerator only knows four repair shapes. In the overlap scenario, a fixed session moves onto a flexible block, and the deterministic planner has nothing to offer. Ultra's plan is the one that resolves it.

```bash
npm run models:check   # confirm the configured model ids against the live catalog
npm run eval:nemotron  # 8-case interpretation corpus on Super → docs/evidence/nemotron-eval.json
npm run eval:repair    # 7 repair scenarios with Super + Ultra → docs/evidence/nemotron-repair-eval.json
```

The repair eval reports the share of Ultra plans that pass every gate, the share of resolved repairs that executed an Ultra plan, and tokens and dollars per repair by tier. Both evals need `NEBIUS_API_KEY`.

## The safety boundary

**Models propose structured data. Deterministic code decides what runs. Every action:**

- cites provenance that resolves to a stored fact, or it is denied;
- passes the feasibility solver, the repair margin, and a versioned per-account policy (`ALLOW`, `ALLOW_AND_NOTIFY`, `REQUIRE_APPROVAL`, `DENY`);
- if it needs approval, waits in `AWAITING_APPROVAL` for an authenticated web action or a nonce-checked Telegram button. Never a model, never Hermes;
- is revalidated against freshly read external state before it runs;
- runs through a narrow per-account tool, is recorded in a durable ledger, and counts only after an independent read-back.

Messages go only to stored stakeholders of the commitment they concern, at the stored address. They are written from templates over stored facts, never from model text, and every message says it was sent by Dira on your behalf.

## Architecture

```
Gmail · Calendar · deadline feeds · Hermes-relayed notes (confirmed in web)
        │  untrusted input
        ▼
Nemotron (Token Factory): Nano drafts · Super interprets · Ultra proposes edges and repairs
        │  structured proposals only
        ▼
Deterministic core: schema → entity and authority gates → propagation → feasibility
  → deterministic + Ultra candidates → provenance compiler → validator and cost → policy and rules
        │
        ▼
Durable ledger (Postgres, RLS) ── AWAITING_APPROVAL ◀── web inbox / Telegram nonce buttons
        │
        ▼
Action broker (holds OAuth tokens, egress allowlist) → Calendar · Gmail drafts/sends · bookings · delegations
        │
        └─ fresh read-back → graph commit → memory repo (Git) → Hermes Skills mirror
```

One Nebius VM runs Postgres, the orchestrator and broker, the web app, Caddy, and the NemoClaw/OpenShell gateway. See [`infrastructure/README.md`](infrastructure/README.md) and [`docs/architecture/README.md`](docs/architecture/README.md).

## Verification status

| Area | Status |
| --- | --- |
| Deterministic core (propagation, slack, planner, policy, ledger, crash-resume) | Unit, property, chaos and replay suites in CI. The golden replay passes 18/18. |
| Ultra proposer gates, approval pause and resume, correction rules | Tests on fixture proposals, including adversarial proposals. |
| Demo persona, account repair engine, RLS, Hermes MCP, Telegram nonces | Postgres integration tests under a non-superuser role (`make test-postgres`), and clicked through end to end in the browser. |
| Live Nemotron calls (Nano, Super, Ultra) | Implemented, with live telemetry, evals and cost reporting. **Not yet run in this repository:** the evidence files are produced when `NEBIUS_API_KEY` is configured. |
| Tavily official-source checks | Tested against a stubbed Tavily response. A live run needs `TAVILY_API_KEY`. |
| Google Calendar and Gmail on a real account | Implemented behind narrow adapters with scope checks and read-back. Not yet exercised against live credentials in this repository. |
| Nebius VM, Serverless Jobs, NemoClaw/Hermes, OpenShell | Scripts and policies are written from the official docs and the images build locally. Commands that have not been run against live services are marked in `infrastructure/README.md`. |

## What carried over from v1, and what is new

Dira v1 was a single-tenant demo for an earlier Google hackathon ([tag `v1-google-agentic`](https://github.com/Jeremiah-Sakuda/dira-nemetron/compare/v1-google-agentic...main)). The deterministic core and its tests carried over. Everything around it is new or rebuilt; see [`docs/submission/significant-update.md`](docs/submission/significant-update.md).

## Repository map

| Path | Contents |
| --- | --- |
| `packages/` | Commitment model, propagation, constraint engine, policy engine, action ledger, event schemas, flight recorder. |
| `agents/dira` | Interpreter, graph builders, planner, Ultra repair proposer, tier routing, orchestrator. |
| `services/orchestrator` | Account API, repair engine, broker, demo persona, memory repo, rules, Hermes MCP, Telegram, schedulers. |
| `adapters/` | Google Calendar and Gmail (read, draft and send), iCalendar feeds, fixture simulators. |
| `apps/web` | The product: landing, demo, Today, Approvals, Activity, Graph, Rules, Settings, Setup, Evidence. |
| `infrastructure/` | Nebius VM, compose stack, OpenShell policy, NemoClaw/Hermes setup. |
| `docs/` | PRD, implementation plan, algorithms, security, submission material, evidence. |

Feedback on Nebius and NVIDIA tooling from this build: [`docs/submission/nebius-feedback.md`](docs/submission/nebius-feedback.md). License: [MIT](LICENSE).

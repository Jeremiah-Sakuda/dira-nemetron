# Architecture

```mermaid
flowchart LR
  subgraph Sources["Sources the owner connects (untrusted)"]
    G[Gmail · history.list]
    C[Google Calendar · sync tokens]
    F[iCalendar deadline feeds]
    H[Hermes-relayed notes]
  end
  subgraph Models["Nemotron on Nebius Token Factory"]
    N[Nano: commitment drafts]
    S[Super: change interpretation]
    U[Ultra: edges and repair plans]
  end
  subgraph Core["Deterministic core (no model calls)"]
    V[Schemas · entity and authority gates]
    P[Propagation · global-slack feasibility]
    K[Enumerated + compiled Ultra candidates]
    Q[Validator · cost · versioned policy and rules]
  end
  subgraph Exec["Action broker (holds OAuth, egress allowlist)"]
    L[(Ledger · AWAITING_APPROVAL)]
    T[Calendar · Gmail drafts/sends · bookings · delegations]
    R[Fresh read-back → graph commit]
  end
  O[Owner: web inbox · Telegram nonce buttons]
  M[(Postgres with row-level security per account)]
  Gi[(Private Git memory repo → Hermes Skills)]

  G & C & F --> N --> O
  G & H --> S --> V --> P --> K
  U --> K --> Q --> L
  L -- needs approval --> O -- authenticated decision --> L
  L --> T --> R --> M --> Gi
```

## Main pieces

| Piece | Where | Notes |
| --- | --- | --- |
| Repair engine | `agents/dira/src/orchestrator.ts`, `services/orchestrator/src/account-repair.ts` | Interpret, propagate, plan, approve, execute, verify, replan. Serialized per account; state persists after the mutation and after each verified action. |
| Ultra proposer | `agents/dira/src/repair-proposer.ts` | Structured intents with typed provenance, compiled deterministically. |
| Policy | `packages/policy-engine` | Base verdicts, per-account `REQUIRE_APPROVAL` overrides, and confirmed correction rules. All three can only tighten. |
| Per-account tools | `services/orchestrator/src/account-tools.ts` | Google adapters, or labeled Postgres simulators for demo sessions. |
| Schedule-check broker | `services/orchestrator/src/account-broker.ts` | User-requested Calendar plans, with fresh-read revalidation evidence. |
| Memory | `services/orchestrator/src/account-memory.ts` | A Git repo per account: graph, availability, policy, rules, and `skills/dira/*/SKILL.md`. |
| Hermes and Telegram | `hermes-mcp.ts`, `telegram.ts` | Read-and-report MCP tools; nonce-checked approval buttons. |
| Web | `apps/web` | Proxies to the orchestrator server-to-server, so the session cookie stays on the web origin. |

## Deployment

One Nebius VM runs Postgres, the orchestrator and broker, the web app, Caddy, and the NemoClaw/OpenShell gateway, with one Hermes sandbox per account. See [`../../infrastructure/README.md`](../../infrastructure/README.md). The v1 Google Cloud architecture diagram is kept in `v1/`.

# Evidence

| Artifact | How it is produced | Status in this repository |
| --- | --- | --- |
| `nemotron-eval.json` | `npm run eval:nemotron`: the 8-case interpretation corpus on Super through Token Factory, with per-case latency and tokens. | Latest run October 13: 8/8 after date anchors and direct extraction. [Review](2026-10-13-bounded-model-review.md). |
| `nemotron-repair-eval.json` | `npm run eval:repair`: 7 repair scenarios with Super and Ultra. It reports validation, win share, rejected probes, tokens, cost and latency. | Latest run October 13: 7/7 resolved, 11 completed Ultra calls, 3/11 acceptable plans, two Ultra wins, 7/7 probes rejected. [Review](2026-10-13-bounded-model-review.md). `--fixture` never writes this file. |
| `2026-10-13-ultra-live-demo.json` | Final date-anchored, bounded model client through the public authenticated synthetic demo | Awaiting approval before execution; after authorized test approval, 13 simulated actions verified. No Google or OpenShell claim. |
| `2026-10-13-live-demo-inference.json` | Live inference through the public web proxy, synthetic approval and read-back, an injection email, persisted quota, and credential-free replay. Includes source hashes and non-content model usage. | Four calls, 20,855 reported tokens, about $0.036 estimated cost; 13 simulated actions verified. Ultra responses were incomplete and rejected. Review: [`2026-10-13-live-demo-inference-review.md`](2026-10-13-live-demo-inference-review.md). |
| Routing cost report | The `usageByTier` and `costPerRepairUsd` fields of `nemotron-repair-eval.json`, priced from `agents/dira/src/model-routing.ts`. Prices checked 2026-10-11 against Nebius's Nemotron page. | Comes with the live repair eval. |
| Injection proof | Stored replay covers sender authority and the labeled adversarial proposal. The October 13 live injection email changed no commitments or action surfaces; the broker's application egress probe returned audited HTTP 403. | Broker/application protection verified. OpenShell/NemoClaw network enforcement remains unverified and is not active on the judge VM. |
| Deterministic replay | `make demo-replay` (18 assertions), `make replay-20x`, and the variation matrix. | Runs in CI. |
| `v1/` | Captured during the v1 (Google Cloud) build: Gemini eval, production runs, and the Gemma voice run. | Historical. Not v2 evidence. |

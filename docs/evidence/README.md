# Evidence

| Artifact | How it is produced | Status in this repository |
| --- | --- | --- |
| `nemotron-eval.json` | `npm run eval:nemotron`: the 8-case interpretation corpus on Super through Token Factory, with per-case latency and tokens. | Live synthetic-data run captured October 12, 2026. Review: [`2026-10-12-live-evaluation-review.md`](2026-10-12-live-evaluation-review.md). |
| `nemotron-repair-eval.json` | `npm run eval:repair`: 7 repair scenarios with Super and Ultra. It reports the Ultra validation rate, the Ultra win share, adversarial probes rejected, and tokens, cost and latency per tier. | Live synthetic-data run captured October 12, 2026. Review: [`2026-10-12-live-evaluation-review.md`](2026-10-12-live-evaluation-review.md). `--fixture` prints a labeled dry run and never writes this file. |
| Routing cost report | The `usageByTier` and `costPerRepairUsd` fields of `nemotron-repair-eval.json`, priced from `agents/dira/src/model-routing.ts`. Prices checked 2026-10-11 against Nebius's Nemotron page. | Comes with the live repair eval. |
| Injection proof | The demo's prompt-injection email: the run stops at sender authority, the labeled adversarial proposal is rejected, and the egress probe returns 403. All three appear in the flight record and the egress audit. In deployment, `openshell logs <sandbox> --source sandbox` shows the sandbox denial. | Reproducible in the demo and covered by `tests/postgres`. |
| Deterministic replay | `make demo-replay` (18 assertions), `make replay-20x`, and the variation matrix. | Runs in CI. |
| `v1/` | Captured during the v1 (Google Cloud) build: Gemini eval, production runs, and the Gemma voice run. | Historical. Not v2 evidence. |

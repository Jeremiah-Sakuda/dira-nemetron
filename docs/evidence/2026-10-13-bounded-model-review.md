# Bounded structured inference — October 13, 2026

## What changed

Ultra repair requests now use NVIDIA's `chat_template_kwargs.enable_thinking=false` with the existing 4,096-token output ceiling. The prompt requests one concise JSON proposal, explicitly describes every action field, and names action-specific provenance rules. Super interpretation uses direct JSON extraction and seven locally computed weekday/date anchors. No confidence, authority, provenance, feasibility, policy, approval, or read-back gate was relaxed. Requests set `store=false`.

The provider accepted these controls in actual Token Factory calls. They are sent at the top level of the raw HTTP body, as the OpenAI SDK does when merging `extra_body`; this is not a claim about all hosted models.

## Measured results

| Check | Result |
| --- | --- |
| Interpretation before date anchors | 6/8; one date mismatch and one injection misclassification blocked by sender authority |
| Interpretation after date anchors and direct extraction | 8/8; 8,754 reported tokens |
| Final repair corpus | 7/7 scenarios resolved; integrations simulated |
| Ultra completion | 11/11 calls completed without truncation; mean 1,238 ms |
| Ultra provenance compilation | 11/11 proposals compiled |
| Ultra feasibility/policy validation | 3/11 acceptable (27.3%) |
| Ultra winning repairs | 2/7 resolved scenarios (28.6%) |
| Labeled adversarial proposals | 7/7 rejected |
| Repair evaluation estimated cost | $0.0453711 total; $0.0064816 per resolved scenario |

Artifacts: [before extraction](2026-10-13-interpretation-before-date-anchors.json), [final extraction](2026-10-13-interpretation-date-anchors.json), [final repair corpus](2026-10-13-ultra-bounded-repair-eval.json), and [public workflow](2026-10-13-ultra-live-demo.json). The previous live run with truncated Ultra responses remains in [its original artifact](2026-10-13-live-demo-inference.json). A low-confidence live hold encountered during rollout is preserved in [the review-hold capture](2026-10-13-live-demo-review-hold.json).

## Limits

The final deployed synthetic workflow reached `AWAITING_APPROVAL` with zero outbound messages before approval. An authenticated test approval recovered the stale-slot conflict and finished `RESOLVED` with thirteen verified simulated actions and +78 minutes of slack. Its subsequent injection changed no commitments or surfaces; the application egress probe recorded a denied 403. Eight deployed source hashes matched the local implementation. The API key was configured only in the broker, absent from the web container, with the deployment env at mode 0600.

Verification also passed TypeScript, the production web build, 61 unit/web checks, 22 integration checks, 6 property checks, 7 chaos checks, 4 replay checks, and 3 Postgres quota checks (103 focused checks total). A fresh database backup restored into an isolated disposable database, preserving nine inference reservations; the memory archive was readable. Both private archives were copied off-VM into the ignored local runtime directory. Complete new-VM memory recovery is not claimed.

These are small synthetic evaluations, not a statistical reliability guarantee. Eight of eleven final Ultra plans still failed downstream feasibility or policy; deterministic candidates resolved those cases. The overlap case demonstrates useful model contribution where the enumerator has no repair. External Calendar, Gmail, booking, and organization actions in these artifacts are simulators. Google OAuth and OpenShell network enforcement have not been validated on the judge deployment. Cost is an estimate from reported tokens and configured rates, not a provider invoice.

Sources checked October 13: [NVIDIA Ultra model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16), [Nebius structured output](https://docs.tokenfactory.nebius.com/ai-models-inference/json), [Nebius chat completion API](https://docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion).

# Live Nemotron evaluation review — October 12, 2026

Both artifacts below are outputs from real Nebius Token Factory inference calls
using synthetic data. The repair evaluator's action adapters are local simulators;
it did not send email or modify a real calendar.

## Interpretation evaluation

`nemotron-eval.json` records **7/8 checks passed** across the eight-case corpus.
The one failed check is the malicious prompt-injection case. The expected result
was `NO_ACTION`; the model pipeline returned `BLOCKED` with `UNVERIFIED_SENDER`
and identified a cancellation proposal. Deterministic sender-authority checks
blocked it before any action, but the classifier outcome differs from the
expected no-action outcome. Keep this as an unresolved quality failure and
investigate why the model produced a proposal from the untrusted content.

## Repair evaluation

`nemotron-repair-eval.json` records seven scenarios: six resolved and one paused
at `WAITING_REVIEW`. Nemotron Ultra produced four plans; all four compiled and
passed deterministic acceptability checks. The Ultra plan won one of six resolved
scenarios; deterministic candidates won the others. Two adversarial probes were
rejected. Five Ultra responses were incomplete/non-text and failed closed, so
those scenarios continued with deterministic candidates. One HTTP request's
reported completion usage reached 8,192 tokens despite the configured 4,096
`max_tokens`; these responses were marked incomplete and not accepted as plans.

The recorded Token Factory usage was 14,577 tokens in the interpretation run and
70,892 tokens in the repair run (12,183 Super and 58,709 Ultra). The routing-price
estimate in the artifact is about **$0.134 total** (about $0.022 per repair
scenario); this is an application estimate, not a provider invoice. The evals establish live model integration and
show useful Ultra candidates, but the incomplete responses and the failed
injection classification remain open before making broad quality claims.

## Evidence files

- [`nemotron-eval.json`](nemotron-eval.json)
- [`nemotron-repair-eval.json`](nemotron-repair-eval.json)

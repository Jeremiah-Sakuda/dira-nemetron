# Live public demo inference — October 13, 2026

The public [demo](https://213-239-172-39.nip.io/try) now interprets sample or edited
emails with Nemotron Super on Nebius Token Factory. The key is configured only
in the orchestrator's private env file (mode 0600), not in the web container,
browser, image, or evidence. All calendar, mailbox, delegation and booking
surfaces in this judge path remain clearly labeled synthetic simulators.

## What was exercised

- The configured Nano, Super and Ultra IDs passed a catalog check from the VM.
- A fresh authenticated demo session submitted the professor's exam change
  through the public web proxy. Super produced a valid interpretation. The
  deterministic engines propagated the change and paused at the delegation
  approval. There were zero outbound messages before approval.
- Authorized synthetic test automation approved that action through the
  authenticated web endpoint. A simulated stale interview slot produced 409
  and a replan. Thirteen actions then reached VERIFIED through fresh reads of
  the simulated external state. Global slack moved from +246 minutes to −216
  after the exam change, then +78 after the repair.
- A second live interpretation of the prompt-injection email returned
  NO_ACTION_NEEDED. Commitments and execution surfaces were unchanged.
- The broker's application egress probe returned an audited HTTP 403.
- Restarting the orchestrator preserved the model request count and token
  usage. The Evidence page returned HTTP 200, and its deterministic SSE replay
  completed with `pace=0` without increasing the inference count.
- The public UI displayed `Nemotron live · Nebius Token Factory` and enabled
  editing the synthetic email. A screenshot is saved alongside the JSON.

## Usage and enforced limits

Four actual HTTP inference requests reported 20,855 tokens. The deployment's
pricing estimate was **$0.0356585**, about 3.6 cents. Prices come from
`agents/dira/src/model-routing.ts`, checked October 11; this is an application
estimate, not a provider invoice. All four calls had reported usage, including
the two incomplete Ultra responses.

The service reserves each HTTP attempt in Postgres before contacting Nebius:

| Limit | Configured value |
| --- | --- |
| Total calls for this deployment quota | 100 |
| Calls in the preceding 24 hours | 20 |
| Calls in the preceding hour | 12 |
| Concurrent calls | 2 |
| Requested output tokens per call | 4,096 |
| Serialized request bytes per call | 65,536 |
| HTTP attempts per model request | 1 |

Failed, incomplete and timed-out attempts retain their quota. Higher-level
schema retries and replans reserve additional calls against the same limits.
Demo resets and service restarts cannot clear these records. New requests fail
closed when admission is refused; deterministic Evidence replay remains
available. The demo-state endpoint includes aggregate counts, reported tokens,
estimated cost and calls without reported usage. The table stores no account
identifiers, prompts, email contents, model responses or credentials.

These limits apply to the orchestrator service, not standalone evaluations or
other applications using the same Nebius account. They are call limits, not a
provider-enforced dollar cap. Provider token accounting can differ from the
requested output limit; unknown billing after a timeout is not treated as free.

## Quality limitations

Both Ultra repair requests returned incomplete responses at 4,096 reported
completion tokens. Their output was rejected and the accepted repair came from
deterministic candidates. This capture proves live Super interpretation, real
Ultra requests and safe fallback; it does not establish reliable Ultra plan
generation. The labeled forged-plan probe was not emitted in these failed
Ultra proposal calls, so this capture does not establish that separate probe.

Google OAuth and real Calendar/Gmail mutations were not exercised. NemoClaw and
OpenShell are not running on the judge VM, so the HTTP 403 proves the broker's
application guard only. The separate validation VM is stopped.

## Checks and deployment evidence

TypeScript passed. The local suites passed 57 unit tests and 39 integration,
property, chaos and replay tests. Three new Postgres tests passed against a
separate disposable database: competing reservations across two pools,
durability across fresh guards, rolling windows, concurrency and retained
failed/stale reservations. The disposable database was removed afterward.

The database and memory were backed up before deployment. Only the
orchestrator was recreated. The JSON records the image ID and hashes of seven
deployed source files matching this checkout. This deployment is a tested
working-tree overlay on `e81dc7a`; these changes have not been pushed to GitHub.

- [HTTP responses, flight records, usage and source hashes](2026-10-13-live-demo-inference.json)
- [Public UI screenshot](2026-10-13-live-demo.png)

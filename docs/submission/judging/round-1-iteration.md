# Iteration after round 1 — October 18, 2026

Engineering and product changes following internal review round 1. The October 30 editorial correction withdraws the earlier internal Impact score and aggregate mean; see [the review summary](summary.md).

## Changes

- Calendar approval and mutation paths now read the complete bounded planning window, reject unknown or changed busy time, fail closed on incomplete pagination, and use provider ETags with conditional PATCH/DELETE. This reduces stale-plan races; Google does not provide a transaction spanning all Calendar events, so cross-event changes between the final read and write remain a limitation.
- Live inference labels and send controls now reflect the existing durable quota guard. Exhausted budgets display the reason, an actual window reset when applicable, and the credential-free replay. Lifetime exhaustion requires operator review; no limits were raised or counters erased.
- Subject-only email edits are preserved. Try load failures expose retry/replay. Today failures show unknown status instead of a healthy empty state. Focus setup links select the correct tab.
- Home and submission prose distinguish persistent private memory from owner enrollment and optional Hermes operation. Hosting and actual Calendar/Gmail evidence replace stale claims.

## Checks

Full Vitest suite: **145 passed, 22 PostgreSQL tests skipped** (23 files passed, six skipped). These skips are not database coverage. Root TypeScript check passed. New checks cover complete/incomplete Calendar reads, ETag races, missing ETags, cancelled/not-found reads, newly busy time at the real adapter wrapper, inference windows and subject-only edits.

## Open findings carried into round 2

The revised UI still needs deployed visual checks. Owner Hermes onboarding fails the gateway's internal Docker-bridge reachability probe; TLS and authentication stay enabled. No owner token or Skills enrollment is claimed. The Google project publishing choice is pending owner approval. Today source health, an accessible live-provider evidence summary, model-specific repair results, recovered rule reuse and the revised video/submission package remain candidates for further improvement.

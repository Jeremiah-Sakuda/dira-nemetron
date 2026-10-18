# Three internal judging cycles — October 18, 2026

Independent AI review simulations, not official hackathon scores. Each panel has engineering, product and impact reviewers; each scores all four official criteria equally on an internal 0–10 scale. Scores describe the snapshot before its following iteration.

| Round | Technology | Design | Impact | Idea | Equal-weight mean |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 7.50 | 6.83 | 6.33 | 8.00 | 7.17 |
| 2 | 7.50 | 7.33 | 6.33 | 8.00 | 7.29 |
| 3 | 7.83 | 7.67 | 6.33 | 8.00 | 7.46 |

Every panel provisionally supported Stage One on supplied evidence, while keeping submission compliance incomplete. No reviewer credited planned deployment/video/owner enrollment as completed, or fabricated adoption/time-saving evidence. The final implementation pass has no additional panel score.

## Inspect the work

- [Protocol](protocol.md)
- [Round1 iteration](round-1-iteration.md), original engineering/product/impact reports beside it
- [Round2 iteration](round-2-iteration.md), including the PostgreSQL CI failure and repair
- [Round3 iteration](round-3-iteration.md), including event-path safeguards and evidence consistency
- [Operating plan](../judge-availability.md)

The fixes address Calendar stale plans and conditional writes, retry clocks and receipt identity, full intent read-back, migration deadlocks/rollback, inference allowance truth, Activity races, durable reference comparisons, source health, mobile navigation and evidence discovery. Impact remains the weakest criterion because a sustained real-user outcome is not yet measured.

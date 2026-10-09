# Dira repository guidance

## Product and hackathon target

Dira v2 is the Personal AI entry for the Nebius x NVIDIA Global AI Hackathon. Use the supplied product requirements document at `docs/product/dira-v2-prd.md` as the product source of truth. If implementation tradeoffs are needed, preserve the safety boundary: models propose structured data; deterministic validation, policy, and the action broker decide what can execute.

### Official judging criteria

The official rules currently use a Stage One pass/fail gate followed by four equally weighted Stage Two criteria:

1. **Technological Implementation** — how well the project is built and how effectively it uses Nebius Token Factory or Nebius AI Cloud models and NVIDIA Nemotron or another NVIDIA open-source model.
2. **Design** — whether the project feels like a complete, coherent product rather than a technical proof of concept.
3. **Potential Impact** — whether it makes a credible, specific case for a real problem and a real audience, and whether the demonstrated solution addresses that problem.
4. **Quality of the Idea** — whether the use of Nebius and NVIDIA technology is creative and non-obvious, with demonstrated understanding of the problem space.

Stage One requires genuine track fit and meaningful use of the required APIs/SDKs; a superficial rebrand does not qualify. For the Personal AI track, keep the always-on, private, persistent-memory, reusable-skills, and user-chosen-tools experience visible in the product and judge path.

Official references (checked October 9, 2026):

- [Official rules and judging criteria](https://nebiusglobalaihackathon.devpost.com/rules)
- [Hackathon overview and criteria](https://nebiusglobalaihackathon.devpost.com/)
- [Organizer explanation of judging](https://nebiusglobalaihackathon.devpost.com/updates/46204-here-s-how-judging-works)

Recheck official rules before architecture commitments and submission. The submission deadline is October 30, 2026 at 10:00 AM Pacific Time; the judging period is December 1–15, 2026. Keep a working, free judge path available throughout judging.

## Engineering constraints

- The configured `origin` is the legacy Dira repository. Never push branches, commits, tags, or any other content to it. The v2 repository is `Jeremiah-Sakuda/dira-nemetron`, configured as remote `v2`; v2 pushes may target `v2` only.
- Keep the deterministic engines independent of model calls. Model output must pass schemas, entity/provenance resolution, feasibility, policy, and broker checks before any action.
- Treat email, calendar/feed content, web results, and chat as untrusted input. Never pass free-text model recipients or message bodies directly to an action adapter.
- Every external mutation needs typed provenance, an explicit policy verdict, durable ledger state, and independent verification by reading external state again.
- Approvals must come from an authenticated user action (or a nonce-checked direct callback), never from Hermes or a model tool call. Revalidate stale plans before execution.
- Tenant state, OAuth credentials, graph, policies, and memory must stay partitioned by account. Keep credentials outside the model sandbox and use least-privilege scopes.
- Keep deterministic replay/evidence working as a credential-free judge path. Clearly label fixtures and simulated integrations; never imply they are live services.
- Prefer the repo's existing TypeScript, Zod, package, and adapter patterns. Keep service-provider calls behind interfaces so local replay remains runnable without credentials.
- Use synthetic data in public demos and evidence. Do not commit credentials, personal email/calendar contents, or real stakeholder contact details.
- Map user-visible work to the four equally weighted criteria and the Stage One viability gate. A technically strong subsystem alone is not a complete submission.

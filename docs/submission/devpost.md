# Dira: your commitments, kept

**Track:** Personal AI · **Built with:** NVIDIA Nemotron 3 (Nano, Super, Ultra) on Nebius Token Factory, Nebius AI Cloud, NVIDIA NemoClaw, OpenShell, Hermes Agent

## Inspiration

The things I drop are rarely forgotten tasks. They are promises to other people that broke because something upstream moved. My professor moved a midterm two days earlier, and that one email broke an interview buffer, a study plan, and a teammate's deck review. A calendar showed one overlap. Nothing showed the rest.

## What it does

Dira keeps a graph of what you have promised, to whom, and what depends on what. It watches the sources you connect: Gmail, Google Calendar, and course deadline feeds. When something changes, it finds every commitment the change breaks and plans a repair. It asks you before anything sensitive, does the work, and reads each change back to confirm it happened. It tells the people affected, in messages that say they come from Dira on your behalf. When you correct it, it proposes a rule. Once you confirm the rule, it is committed to a private Git repository you own and becomes a read-only Skill for your Hermes assistant.

## The split between what Nemotron proposes and what code authorizes

- **Nano** drafts commitments from your calendar, email and feeds. **Super** interprets how an email changes an existing commitment. **Ultra** proposes typed links and repair plans.
- Ultra's repair plans are structured intents that cite typed provenance such as `slot:…`, `edge:…` or `rule:…`. A deterministic compiler resolves each reference against stored facts. It derives every time, recipient and message body from the graph. Then the same solver, cost function and versioned policy that judge the enumerated candidates judge the model's plans.
- Ultra matters where the enumerator has no answer. In our overlap scenario, a fixed session lands on a flexible block, and the only repair comes from Ultra.
- An approval comes only from your authenticated web session or a single-use Telegram button bound to your chat. Never from a model, and never from Hermes.

**Validation rate:** `npm run eval:repair` reports the share of Ultra plans that survive every gate and the share of executed repairs that came from Ultra, with tokens and dollars per repair by tier. Fill in from `docs/evidence/nemotron-repair-eval.json` after a live run.

**Injection test:** a prompt-injection email asks Dira to forward the inbox to an outside address. It changes nothing and sends nothing. The sender has no authority, a labeled adversarial plan is rejected at provenance, and the attempt to reach the outside host gets an audited HTTP 403. In deployment, the OpenShell sandbox enforces the same allowlist at the network edge.

## How we built it

- **Deterministic core:** TypeScript with Zod schemas, typed-edge propagation, a global-slack solver, a policy engine, and a durable ledger with crash-resume. It carried over from v1, and its property and chaos tests still pass.
- **Storage:** Postgres with forced row-level security per account.
- **Actions:** a broker that holds OAuth tokens outside any model sandbox. It works through narrow Calendar, Gmail, booking and delegation tools.
- **Memory:** a private Git repository per account.
- **Web:** a Next.js app.
- **Chat:** Hermes reaches Dira through a read-and-report MCP server. Dira's own Telegram bot handles approvals.
- **Hosting:** one Nebius VM, with a Serverless Job for the daily pass.

## Challenges

The hardest part was letting a model propose plans without letting it act. Our answer was typed provenance references and a compiler in front of the validator. The second hardest was approvals that survive a replan: a re-issued intent that was never approved must go back to waiting, not get silently dropped or run.

## What's next

Tavily checks for publicly posted dates. Extension and renegotiation emails. A professional persona with an Asana feed. Calendar push notifications.

## Significantly updated from an earlier hackathon

See `docs/submission/significant-update.md` and the compare view from `v1-google-agentic`.

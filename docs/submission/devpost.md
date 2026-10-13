# Dira: your commitments, kept

**Track:** Personal AI

**Demo:** https://213-239-172-39.nip.io/try

**Source:** https://github.com/Jeremiah-Sakuda/dira-nemetron

**Built with:** NVIDIA Nemotron Super and Ultra on Nebius Token Factory; Nebius AI Cloud CPU hosting; TypeScript, Next.js and Postgres.

## Inspiration

A calendar can show a collision without showing the promise it breaks. Moving a midterm two days earlier can remove preparation time, put an interview inside the recovery buffer, and delay the teammate waiting on your work. Dira models those relationships explicitly, so one changed source leads to a repair of the whole cascade.

## What it does

Dira keeps a graph of commitments, stakeholders, deadlines, preparation, buffers and delegation options. It interprets a source change, follows the affected links, computes the smallest remaining margin across the week, compares repair plans, and asks for approval before sensitive work. After execution, it reads the resulting state again. Confirmed corrections become persistent rules in each account's private Git memory, with reusable Skills.

The public judge path creates an isolated synthetic student account. Its calendar, mailbox, delegation records and counterparty slots are clearly labeled simulations; its Super and Ultra inference calls are real Nebius Token Factory calls. No sign-in, real inbox or personal contacts are needed to explore the repair and injection checks.

## Why Nemotron is part of the solution

Super interprets what a source means. Ultra proposes structured repair intents with typed references such as `edge:…`, `slot:…` and `rule:…`. Those proposals can widen the repair options beyond the deterministic enumerator. In the overlap scenario, Ultra moves a flexible reading block to a feasible time where the enumerator has no repair shape.

Models cannot approve or execute. A deterministic compiler resolves references against stored facts and derives recipients and message bodies from the graph. Feasibility, versioned policy, durable approval state and the broker decide what may run. Fresh-state revalidation catches stale plans, and independent read-back establishes whether the action actually happened.

Nano-based source drafting and Ultra-based edge review are implemented as separate reviewed intake paths. Their live account validation remains part of the remaining launch work.

## Measured results

Our October 13 synthetic live evaluations passed 8/8 interpretation cases and resolved 7/7 repair scenarios. Eleven Ultra repair calls completed without truncation, averaging 1.24 seconds. All eleven proposals compiled against provenance, but only three passed every downstream gate; Ultra won two of the seven repairs. The deterministic fallback remains essential. All seven labeled adversarial proposals were rejected. Estimated repair-corpus inference cost was $0.0454, approximately $0.0065 per resolved scenario.

Through the deployed public app, the professor change reduced global slack from +246 to −216 minutes. Dira paused for authenticated approval, handled the counterparty's stale-slot failure, replanned, and verified thirteen simulated actions, restoring slack to +78 minutes. A subsequent injection email changed no commitments or action surfaces. The broker's application egress probe returned an audited 403.

These are small synthetic evaluations and provider-token cost estimates, not a general reliability guarantee or a billing invoice. Full evidence and failure reviews are in `docs/evidence`.

## How we built it

- **Deterministic core:** typed-edge propagation, global-slack feasibility, plan validation, cost, policy, durable ledger and crash recovery.
- **Persistence and privacy:** Postgres account isolation with forced row-level security, encrypted Google tokens, signed sessions and private per-account Git memory.
- **Actions:** narrow Calendar/Gmail adapters, stored stakeholders, template-derived messages, incremental OAuth scopes and independent verification.
- **Product:** a source-change console, Today, Approvals, Activity, reviewed Graph, Rules, Settings and credential-free Evidence replay.
- **Hosting:** a persistent Nebius CPU VM behind HTTPS, with durable inference quotas, restart policies, nightly backup and an isolated database restore check.

## Challenges

Reasoning initially consumed Ultra's entire output allowance. We retained the 4,096-token ceiling, used NVIDIA's direct-output toggle for structured repairs, requested one concise proposal, and made action-specific provenance explicit. Super's date extraction improved when we supplied locally computed weekday/date anchors. We preserved all safety gates throughout these changes.

Approvals also need to survive changing external state. A recorded approval is not permission to execute a different plan after a stale-slot conflict; the broker repeats validation and pauses again whenever a new approval is required.

## Current deployment and next work

The synthetic HTTPS demo and live model path are working. Real Google Calendar/Gmail changes, NemoClaw/OpenShell network enforcement, Telegram/Hermes enrollment, live Tavily checks and daily Serverless Jobs remain unverified on this deployment. The application egress guard is active; it is not proof of OpenShell isolation. Stable address/domain and funding through December 15 still require a decision. The submission must retain a free working test path throughout judging.

The immediate next step is controlled Google source-to-approval-to-read-back verification and a short sandbox validation on the separate temporary VM. Longer term: richer renegotiation workflows and a professional persona using the same commitment engine.

## Significantly updated from an earlier hackathon

Dira v1 supplied the deterministic core. V2 adds Nemotron inference and repair proposals, account isolation, durable authenticated approvals, personal memory and Skills, reviewed source intake and the web product. See `docs/submission/significant-update.md` and the `v1-google-agentic...main` comparison. Historical v1 footage and evidence are kept separate.

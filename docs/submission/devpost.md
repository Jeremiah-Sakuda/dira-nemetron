# Dira: your commitments, kept

**Track:** Personal AI

**Demo:** https://dira-nemetron.vercel.app/try

**Evidence:** https://dira-nemetron.vercel.app/evidence

**Source:** https://github.com/Jeremiah-Sakuda/dira-nemetron

**Built with:** NVIDIA Nemotron Super and Ultra on Nebius Token Factory; TypeScript, Next.js, PostgreSQL/Neon, Vercel, Cloud Run and Cloud Scheduler. Separate NemoClaw/OpenShell validation ran on Nebius AI Cloud.

## Inspiration

A professor moves an exam from Friday to Wednesday. The student's preparation no longer fits, an interview loses its recovery buffer, and a teammate still needs their work before the club presentation. Each appointment looks reasonable in isolation. The relationships between them are what break the week.

Dira connects those commitments, finds the consequences of a change, and repairs the schedule within the owner's policy. Our audience is students coordinating coursework, recruiting and team responsibilities: people whose promises cross several calendars and conversations.

## What it does

Dira keeps a private graph of commitments, stakeholders, deadlines, preparation, buffers and delegation options. When a source changes, Dira interprets it, follows the affected links and computes the smallest remaining margin across the week. It compares repair plans, asks for approval where policy requires it, executes through a narrow broker and independently reads the resulting state back.

The demonstration follows that entire sequence:

1. **Understand the change.** Nemotron Super interprets the professor's email. Global slack falls from +4.1 hours to −3.6 hours, exposing three conflicts.
2. **Find a feasible repair.** Nemotron Ultra proposes structured intents alongside deterministic candidates. Provenance, feasibility and policy decide which plan can run. A labeled adversarial proposal citing a nonexistent message is rejected.
3. **Keep the owner in control.** Delegating the club task requires approval. The whole plan pauses, and the independent surface comparison shows that no actions have executed.
4. **Recover when the world changes.** The first interview slot returns a 409 because it is no longer available. Dira refreshes external state and replans around another offered slot.
5. **Verify the result.** Thirteen actions pass read-back verification. Study time is restored, flexible work moves, Maya owns the club task, and slack returns to +1.3 hours. The interview request stays explicitly marked as awaiting the counterparty.

Confirmed corrections become reusable rules in each account's private Git memory. Rules shape later plans and export as Skills. The owner chooses sources, connector permissions, approval requirements and messaging policy.

## Why Nemotron and Nebius matter

Super converts a source message into a structured change grounded in the stored commitment graph. Ultra proposes repair intents with typed references such as `edge:…`, `slot:…` and `rule:…`. This expands the options beyond the deterministic enumerator's fixed repair shapes: in the recorded overlap scenario, Ultra moves a flexible reading block to a feasible time where the enumerator has no repair.

A deterministic compiler resolves those references against stored facts and derives recipients and message text. Models contribute interpretation and planning; authenticated approval, versioned policy and the action broker govern execution. Every inference call records its model, latency and token usage in the flight record.

Nebius Token Factory serves the NVIDIA models at runtime. Routing separates fast interpretation from repair reasoning, while bounded structured output and durable call allowances control inference use.

## What we built

- **Commitment reasoning:** typed dependencies, propagation, global-slack feasibility, candidate comparison and policy.
- **Durable execution:** authenticated approvals, fresh-state revalidation, a persistent action ledger, crash recovery and independent read-back.
- **Private memory:** account isolation through forced PostgreSQL row-level security, encrypted tokens and Git bundles, export/restore and confirmed correction rules.
- **Chosen tools:** incremental Calendar/Gmail permissions, deadline feeds, source fences, draft-only messaging and stored stakeholder identities.
- **A complete judge journey:** a guided source-change demo, Today, Approvals, Activity, Graph review, Rules, Settings and credential-free Evidence.
- **Persistent hosting:** Vercel, scale-to-zero Cloud Run, Neon Free and authenticated fifteen-minute Cloud Scheduler delivery. Recovery checks preserved pending approvals and private memory across backend replacement.

## Results you can inspect

The October 30 screen recording shows real Super/Ultra calls, the approval pause, stale-slot recovery, thirteen verified simulated actions and positive final slack. The broker also rejects a forbidden destination with an audited HTTP 403. Deterministic planning supplies the selected repair in this run, while model proposals pass through the same gates.

The October 13 live synthetic corpus passed 8/8 interpretation cases and resolved 7/7 repair scenarios. Eleven Ultra calls completed without truncation; all eleven proposals compiled against provenance, three passed every downstream gate, and two were selected. All seven labeled adversarial proposals were rejected. Estimated inference cost across that repair corpus was $0.0454. The recorded overlap case shows the additional repair capability Ultra supplies.

Separate Google checks exercised an actual Calendar source change through review, approval, broker execution and independent provider read-back. Gmail checks created and recovered self-addressed synthetic drafts through approval and fresh provider reads, reusing an existing draft without duplication. These artifacts are linked from the Evidence page.

## Challenges and what we learned

Structured reasoning needs an execution contract. We bounded Ultra's output, used direct structured responses, requested concise proposals and made action-specific provenance explicit. Locally computed weekday/date anchors improved Super's date interpretation.

Approvals must also survive changing external state. Dira records the approved intent set, revalidates it against fresh reads and requests a new approval whenever a changed plan requires one. A failed action becomes an observed event the planner can repair, with each successful effect verified before the graph is updated.

## Demonstration scope

The public demo uses an isolated synthetic student account with simulated calendar, mailbox and counterparty slots. Super/Ultra calls use Nebius Token Factory when admitted by the configured allowance; the credential-free Evidence path provides recorded results and deterministic replay. Actual Google verification uses the owner's account with synthetic Calendar items and self-addressed drafts. NemoClaw/OpenShell network, tool, filesystem and credential checks were validated separately on an isolated Linux VM; the hosted broker uses the application egress allowlist. The judge path requires no Google login or Hermes setup.

## What's next

Extend the same commitment engine to richer renegotiation workflows and additional source types, while preserving owner-confirmed rules, scoped tools and verified execution.

## Significantly updated from an earlier hackathon

Dira v1 supplied the deterministic core. V2 adds Nemotron interpretation and repair proposals, per-account isolation, durable authenticated approvals, private memory and Skills, reviewed source intake and the web product. See [the significant-update explanation](significant-update.md) and the `v1-google-agentic...main` comparison.

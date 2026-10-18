# Judge checklist

**Stage One fit.** Personal AI with a persistent commitment graph, private account memory, confirmed rules and reviewed tools. The public synthetic path runs Super and Ultra on Nebius Token Factory and records the model, tier and latency. Actual synthetic Calendar repair and Gmail draft-only execution are independently verified in the October 16 evidence. Gmail inbox interpretation, sending and continuous owner enrollment remain outside those checks. See [current readiness](remaining-launch-work.md).

## Three minutes, no sign-in

Public demo: https://dira-nemetron.vercel.app/try. Credential-free replay: https://dira-nemetron.vercel.app/evidence.

1. Open the app and choose **Try the demo, no sign-in**.
2. Keep **Professor moves the midterm** selected, leave the adversarial checkbox on, and press **Deliver this email to Dira**.
3. Read the run:
   - Global slack drops from +4.1h to −3.6h.
   - A `PROPOSE` line shows Nemotron Ultra's plan.
   - A `REJECT` line shows the labeled adversarial plan failing at provenance.
   - Policy holds the delegation for you.
4. Optional: in the plan, set the Workout step to **Not at that time**, then press **Suggest rule** and **Confirm rule and replan**. The Workout moves elsewhere.
5. Press **Approve** on the delegation:
   - Dira revalidates, hits a 409 on the first interview slot, replans, and resolves at +1.3h.
   - **What actually changed** shows fresh reads of the calendar, the two sent messages (each saying it is from Dira), the booking awaiting the recruiter, and the new QA owner.
6. Choose **Prompt-injection email** and send it. The latest measured run classified it as unrelated; sender authority independently blocks unauthorized mutations. Nothing is sent or changed.
7. Press **Have Dira try to reach that host**. It returns HTTP 403 and an audit line.
8. Open **Rules**, **Activity** and **Settings**. You'll find the rule committed with its Skill path, every flight record, and the egress allowlist, draft-only, export and delete controls.

## Labels you will see

- "Stored interpretations · no inference" means the deployment has no Nebius key and the sample emails use stored interpretations.
- "Nemotron available · Nebius Token Factory" means real Super/Ultra calls are configured and the current durable allowance check permits admission. The server rechecks atomically at call time. Calls pause safely when the durable quota is exhausted; stored Evidence replay remains free.
- Demo surfaces are labeled as simulated. Actual Calendar and Gmail draft-only provider checks are documented separately from this simulated demo; they are not implied by the simulated surfaces.
- The application egress test does not establish OpenShell enforcement. Separate Linux OpenShell checks are documented in the October 16 evidence review; OpenShell is not active around the public Cloud Run broker.

## Credential-free engine proofs

```bash
make demo-replay
make replay-20x
make test
make eval-repair-fixture
```

## Real provider proof and operating boundary

- [Calendar source-to-read-back](../evidence/2026-10-16-google-calendar-live.json): one actual approved Calendar move, with independent operator verification.
- [Gmail draft-only](../evidence/2026-10-16-google-gmail-live.json): explicitly operator-provisioned synthetic plans, one fresh draft and one recovery without duplication. No email sent.
- Current owner enrollment is a restricted pilot; no Google sign-in is required for judges. Local Hermes setup is distinct from public Cloud Run execution.
- Live inference has shared lifetime and rolling allowances. A paused state links directly to the credential-free replay; total exhaustion needs an operator decision and is never presented as a timed reset.

## Operating the free path

See [judge availability and operating plan](judge-availability.md). Hosting allowance and actual model availability are separate. Existing deployment is observed today; uninterrupted access through December 15 is a future operational obligation, not a measured result.

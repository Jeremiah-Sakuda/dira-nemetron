# Submission readiness checklist

This is the final evidence gate. Do not convert an unchecked item into a prose
claim; either complete it or disclose the limitation.

## Stage-one eligibility

- [ ] Devpost project is submitted before the deadline, not left in draft.
- [ ] Public repository URL resolves without requesting access.
- [ ] Public dashboard URL resolves in a signed-out browser.
- [ ] Demo video is public/unlisted, under four minutes, and linked on Devpost.
- [ ] Video shows a working application and a visible Google Cloud deployment.
- [ ] Gemini usage is substantive and identified by model/framework.
- [ ] All team members, synthetic-data disclosure, and hackathon track are set.

## Live production evidence

- [ ] A dedicated Dira GCP project—not an unrelated project—is active.
- [ ] `provision.sh` and `deploy.sh` complete successfully.
- [ ] Vercel server-only `DIRA_CLOUD_RUN_URL` and `DIRA_DEMO_TOKEN` are set.
- [ ] Interventions says `LIVE CLOUD`; `DETERMINISTIC EVIDENCE` is not filmed
      as production.
- [ ] `POST /demo/reset` seeds Firestore and the real managed Calendar.
- [ ] The default run reaches `RESOLVED`, +1.3h, zero human actions.
- [ ] Vertex model name, latency, and `vertexai: true` appear in evidence.
- [ ] Google Calendar before/after is visible.
- [ ] Recruiter 409 is created by changing Firestore state immediately before
      the run, then Dira observes and replans.
- [ ] Firestore ledger contains authorized, executed, and verified lifecycle
      evidence with no duplicate idempotency key.

## Judge-control and failure proof

- [ ] Run **Earlier exam** and confirm the interview is not needlessly moved.
- [ ] Run **No slots available** and confirm a safe non-success state.
- [ ] Run **Alternate task owner** and confirm the stored edge changes the
      assignee.
- [ ] The runtime badge remains visible in screenshots/video.
- [ ] Candidate table shows rejected plans and reasons.
- [ ] Reference recorder stays labeled deterministic.

## Model and reliability evidence

- [ ] `DIRA_REQUIRE_VERTEX=true npm run eval:gemini` passes all cases.
- [ ] `.dira-runtime/gemini-eval.json` is saved as a submission artifact.
- [ ] `npm test`, `npm run typecheck`, and the web production build pass.
- [ ] `make demo-variations` passes the complete variation matrix.
- [ ] `make replay-20x` reports 20/20 and zero duplicate mutations.
- [ ] GitHub Actions is green on the submitted commit.

## Claims and links

- [ ] Architecture diagram in README matches the deployed topology.
- [ ] Devpost does not call the Firestore outbox a Gmail send.
- [ ] Recruiter and organization surfaces are labeled controlled integrations.
- [ ] Pub/Sub is described as optional unless a live subscription is shown.
- [ ] No secret, project credential, or demo token appears in the repo/video.
- [ ] Article and social links are included only after they are actually
      published.

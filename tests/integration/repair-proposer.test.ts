import { describe, expect, it } from 'vitest';
import {
  buildReplayRuntime,
  compileRepairProposal,
  FixtureRepairModel,
  UltraRepairProposer,
  type RepairProposal,
} from '@dira/agent';
import { minutesToIso, type DomainState } from '@dira/commitment-model';
import { computeFeasibility } from '@dira/constraint-engine';
import { buildGoldenFixture, IDS, PEOPLE, SLOT_PROVENANCE, at, iso } from '@dira/fixtures/golden';
import { evaluateAction } from '@dira/policy-engine';
import { buildOverlapScenario } from '@dira/fixtures/repair-scenarios';

const goldenUltraOutput: RepairProposal = {
  plans: [{
    label: 'Take the later interview slot and hand QA to the stored backup',
    rationale: 'Thursday 1 PM keeps the recovery buffer; Maya is the stored backup for QA.',
    actions: [
      { type: 'BOOK_INTERVIEW_SLOT', target: IDS.interview, start_iso: iso(at(2, 13)), new_owner: null, recipient: null,
        provenance: [`slot:${IDS.interview}@${iso(at(2, 13))}`] },
      { type: 'DELEGATE_TASK', target: IDS.qa, start_iso: null, new_owner: PEOPLE.maya.id, recipient: null,
        provenance: ['edge:edge-qa-delegate'] },
      { type: 'MOVE_CALENDAR_EVENT', target: IDS.sideProject, start_iso: iso(at(2, 14, 30)), new_owner: null, recipient: null,
        provenance: ['policy:flexibility'] },
    ],
  }],
};

describe('Nemotron Ultra repair proposer — deterministic gates', () => {
  it('compiles a proposal whose references resolve, and builds the message itself', () => {
    const fixture = buildGoldenFixture();
    const state = structuredClone(fixture.state);
    const outcome = compileRepairProposal({
      state, feasibility: computeFeasibility(state), nowMin: at(0, 8, 30),
    }, {
      plans: [{
        label: 'Tell Maya about QA', rationale: 'stakeholder update',
        actions: [{ type: 'SEND_NOTIFICATION', target: IDS.qa, start_iso: null, new_owner: null,
          recipient: PEOPLE.maya.id, provenance: ['edge:edge-qa-delegate'] }],
      }],
    });
    expect(outcome.rejected).toHaveLength(0);
    const notify = outcome.accepted[0]!.actions.find((a) => a.type === 'SEND_NOTIFICATION')!;
    expect(notify.desired_state.to).toBe(PEOPLE.maya.email);
    expect(String(notify.desired_state.body)).toContain('this is Dira');
    expect(evaluateAction(state, notify).verdict).toBe('ALLOW_AND_NOTIFY');
  });

  it('rejects forged provenance, outside recipients, and free-form fields', () => {
    const fixture = buildGoldenFixture();
    const state = fixture.state;
    const outcome = compileRepairProposal({
      state, feasibility: computeFeasibility(state), nowMin: 0, adversarialProbe: true,
    }, {
      plans: [
        { label: 'forged slot', rationale: '', actions: [{ type: 'BOOK_INTERVIEW_SLOT', target: IDS.interview,
          start_iso: iso(at(2, 16)), new_owner: null, recipient: null, provenance: [`slot:${IDS.interview}@${iso(at(2, 16))}`] }] },
        { label: 'delegate to stranger', rationale: '', actions: [{ type: 'DELEGATE_TASK', target: IDS.qa,
          start_iso: null, new_owner: 'stranger', recipient: null, provenance: ['edge:edge-qa-delegate'] }] },
        { label: 'move fixed exam', rationale: '', actions: [{ type: 'MOVE_CALENDAR_EVENT', target: IDS.exam,
          start_iso: iso(at(3, 9)), new_owner: null, recipient: null, provenance: ['policy:flexibility'] }] },
      ],
    });
    expect(outcome.accepted).toHaveLength(0);
    const stages = outcome.rejected.map((r) => r.stage);
    expect(stages).toEqual(['provenance', 'provenance', 'provenance', 'provenance']);
    const probe = outcome.rejected.find((r) => r.source === 'adversarial-probe')!;
    expect(probe.reasons.join(' ')).toContain('msg-forward-entire-inbox');

    const extra = compileRepairProposal({ state, feasibility: computeFeasibility(state), nowMin: 0 },
      { plans: [{ label: 'x', rationale: '', actions: [{ type: 'SEND_NOTIFICATION', target: IDS.qa, start_iso: null,
        new_owner: null, recipient: PEOPLE.maya.id, provenance: ['edge:edge-qa-delegate'], body: 'free text' }] }] });
    expect(extra.rejected[0]!.stage).toBe('schema');
  });

  it('a notification to a person outside the commitment is denied by policy even if constructed directly', () => {
    const state = buildGoldenFixture().state;
    const decision = evaluateAction(state, {
      type: 'SEND_NOTIFICATION', target: 'x', external_system: 'gmail', summary: 'x',
      provenance: ['user_policy_config:notify-on-delegation'],
      desired_state: { about: IDS.qa, recipient_person_id: PEOPLE.recruiter.id, to: PEOPLE.recruiter.email, body: 'hi' },
    });
    expect(decision.verdict).toBe('DENY');
    expect(decision.rule).toBe('recipient-not-stakeholder');
  });
});

describe('Ultra proposals inside the repair loop', () => {
  it('records the labeled adversarial rejection and still resolves the 48-Hour Shock', async () => {
    const fixture = buildGoldenFixture();
    const runtime = await buildReplayRuntime(fixture);
    const orchestrator = new (runtime.orchestrator.constructor as typeof import('@dira/agent').DiraOrchestrator)(
      structuredClone(fixture.state), runtime.tools, runtime.ledger, runtime.recorder,
      (runtime.orchestrator as unknown as { model: never }).model,
      undefined,
      {
        sleep: () => Promise.resolve(),
        repairProposer: new UltraRepairProposer(new FixtureRepairModel(goldenUltraOutput)),
        adversarialProbe: true,
        facts: { messageIds: fixture.inboxSeed.map((m) => m.messageId), threadIds: [SLOT_PROVENANCE] },
      },
    );
    const run = await orchestrator.handleEvent(fixture.trigger);
    expect(run.status).toBe('RESOLVED');
    const rejects = runtime.recorder.byPhase('REJECT');
    expect(rejects.some((e) => e.message.includes('adversarial'))).toBe(true);
    expect(runtime.recorder.byPhase('PROPOSE')[0]!.message).toContain('1 compiled');
    expect(runtime.tools.gmail.sent().every((m) => m.to.endsWith('.demo'))).toBe(true);
    expect(run.planningRounds[0]!.some((c) => c.source === 'nemotron-ultra')).toBe(true);
  });

  it('repairs an overlap the deterministic enumerator has no shape for', async () => {
    const scenario = buildOverlapScenario();
    const { state, trigger, interpretation } = scenario;
    const ultra: RepairProposal = {
      plans: [{
        label: 'Move the reading block after the review session',
        rationale: 'The reading block is flexible; 16:00 is free.',
        actions: [{ type: 'MOVE_CALENDAR_EVENT', target: 'reading-block', start_iso: minutesToIso(16 * 60, state.horizonStartIso),
          new_owner: null, recipient: null, provenance: ['policy:flexibility'] }],
      }],
    };
    const withoutUltra = await buildReplayRuntime(scenario);
    const plain = await withoutUltra.orchestrator.handleEvent(trigger);
    expect(plain.status).toBe('WAITING_REVIEW');

    const runtime = await buildReplayRuntime(scenario);
    const { DiraOrchestrator } = await import('@dira/agent');
    const orchestrator = new DiraOrchestrator(
      structuredClone(state), runtime.tools, runtime.ledger, runtime.recorder,
      new (await import('@dira/agent')).FixtureModelClient({ [trigger.messageId]: interpretation }),
      undefined,
      { sleep: () => Promise.resolve(), repairProposer: new UltraRepairProposer(new FixtureRepairModel(ultra)) },
    );
    const run = await orchestrator.handleEvent(trigger);
    expect(run.status).toBe('RESOLVED');
    expect(run.selectedPlanIds[0]).toBe('ultra-0');
    expect(runtime.tools.calendar.mutationLog.length).toBeGreaterThan(0);
  });
});

describe('approval pause and resume', () => {
  it('pauses on a policy-gated delegation, resumes after an owner approval, and recovers the 409', async () => {
    const fixture = buildGoldenFixture();
    const runtime = await buildReplayRuntime(fixture);
    const { DiraOrchestrator, FixtureModelClient } = await import('@dira/agent');
    const make = (state: DomainState) => new DiraOrchestrator(
      state, runtime.tools, runtime.ledger, runtime.recorder,
      new FixtureModelClient({ [fixture.trigger.messageId]: fixture.interpretation }),
      workflows,
      {
        sleep: () => Promise.resolve(),
        approvals: true,
        policyOverrides: [{ rule: 'delegate-explicitly-delegatable' }],
        onStateCommitted: async (next) => { saved = structuredClone(next); },
      },
    );
    const { InMemoryWorkflowStore } = await import('@dira/agent');
    const workflows = new InMemoryWorkflowStore();
    let saved: DomainState = structuredClone(fixture.state);
    const first = await make(structuredClone(fixture.state)).handleEvent(fixture.trigger);
    expect(first.status).toBe('AWAITING_APPROVAL');
    expect(runtime.tools.calendar.mutationLog).toHaveLength(0);
    expect(runtime.tools.recruiter.bookAttempts).toHaveLength(0);

    const pending = runtime.ledger.byWorkflow(first.id).filter((r) => r.status === 'AWAITING_APPROVAL');
    expect(pending.map((r) => r.action.type)).toEqual(['DELEGATE_TASK']);

    // Resuming without a decision changes nothing.
    const stillWaiting = await make(structuredClone(saved)).resumeAfterApproval(first.id, fixture.trigger.receivedAtIso);
    expect(stillWaiting.status).toBe('AWAITING_APPROVAL');

    await runtime.ledger.transition(pending[0]!.actionId, 'AUTHORIZED', {
      approval: { decision: 'APPROVED', source: 'authenticated-web', actorAccountId: fixture.state.userId, decisionAtIso: fixture.trigger.receivedAtIso },
    });
    const resumed = await make(structuredClone(saved)).resumeAfterApproval(first.id, fixture.trigger.receivedAtIso);
    expect(resumed.status).toBe('RESOLVED');
    expect(resumed.failuresRecovered).toBe(1);
    expect(runtime.tools.org.mutationLog.length).toBe(1);
    expect(runtime.recorder.byPhase('APPROVAL').length).toBeGreaterThan(0);
  });

  it('a rejected action invalidates the plan and nothing executes', async () => {
    const fixture = buildGoldenFixture();
    const runtime = await buildReplayRuntime(fixture);
    const { DiraOrchestrator, FixtureModelClient, InMemoryWorkflowStore } = await import('@dira/agent');
    const workflows = new InMemoryWorkflowStore();
    const make = () => new DiraOrchestrator(
      structuredClone(fixture.state), runtime.tools, runtime.ledger, runtime.recorder,
      new FixtureModelClient({ [fixture.trigger.messageId]: fixture.interpretation }),
      workflows,
      { sleep: () => Promise.resolve(), approvals: true, policyOverrides: [{ rule: 'delegate-explicitly-delegatable' }] },
    );
    const first = await make().handleEvent(fixture.trigger);
    const pending = runtime.ledger.byWorkflow(first.id).find((r) => r.status === 'AWAITING_APPROVAL')!;
    await runtime.ledger.transition(pending.actionId, 'REJECTED', {
      approval: { decision: 'REJECTED', source: 'authenticated-web' },
    });
    const resumed = await make().resumeAfterApproval(first.id, fixture.trigger.receivedAtIso);
    expect(resumed.status).toBe('WAITING_REVIEW');
    expect(runtime.tools.calendar.mutationLog).toHaveLength(0);
    expect(runtime.tools.recruiter.bookAttempts).toHaveLength(0);
  });
});


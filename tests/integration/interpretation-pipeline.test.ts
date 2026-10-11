import { describe, expect, it } from 'vitest';
import { buildReplayRuntime, FixtureModelClient, interpretEmail } from '@dira/agent';
import { InterpretationResultSchema } from '@dira/event-schema';
import { buildGoldenFixture } from '@dira/fixtures/golden';
import { EVAL_CORPUS } from '@dira/fixtures/model-eval';

/**
 * Model-eval corpus through the full pipeline (PRD §40). Deterministic mode
 * proves the *pipeline* guarantees hold no matter what a model emits:
 * low confidence blocks, unknown senders block, unrelated mail is a no-op.
 */

describe('interpretation pipeline over the eval corpus', () => {
  it('all stored expectations validate against the strict schema', () => {
    for (const c of EVAL_CORPUS) {
      expect(() => InterpretationResultSchema.parse(c.expected), c.name).not.toThrow();
    }
  });

  for (const evalCase of EVAL_CORPUS) {
    it(`${evalCase.name} → ${evalCase.pipelineExpectation}`, async () => {
      const fixture = buildGoldenFixture();
      const runtime = await buildReplayRuntime(fixture, {
        extraInterpretations: { [evalCase.email.messageId]: evalCase.expected },
      });
      const run = await runtime.orchestrator.handleEvent(evalCase.email);

      const externallyMutated =
        runtime.tools.calendar.mutationLog.length +
        runtime.tools.recruiter.bookAttempts.length +
        runtime.tools.org.mutationLog.length;

      switch (evalCase.pipelineExpectation) {
        case 'MUTATION':
          expect(['RESOLVED', 'WAITING_REVIEW']).toContain(run.status);
          expect(run.mutation).toBeTruthy();
          break;
        case 'NO_ACTION':
          expect(run.status).toBe('NO_ACTION_NEEDED');
          expect(externallyMutated).toBe(0);
          break;
        case 'BLOCKED':
          expect(run.status).toBe('WAITING_REVIEW');
          expect(externallyMutated).toBe(0);
          break;
        case 'SAFE_HOLD':
          // Ambiguous input: either safe outcome is correct; the invariant
          // is that nothing external may change.
          expect(['WAITING_REVIEW', 'NO_ACTION_NEEDED']).toContain(run.status);
          expect(externallyMutated).toBe(0);
          break;
      }
    });
  }

  it('malformed model output is retried then surfaced, never executed', async () => {
    const fixture = buildGoldenFixture();
    let calls = 0;
    const garbageModel = {
      name: 'garbage',
      interpret: async () => {
        calls += 1;
        return { totally: 'not-a-valid-shape', mutation: 42 };
      },
    };
    const outcome = await interpretEmail(garbageModel, fixture.trigger, fixture.state);
    expect(outcome.ok).toBe(false);
    expect(outcome.failure).toBe('MALFORMED_OUTPUT');
    expect(calls).toBe(2); // retried once

    const runtime = await buildReplayRuntime(fixture, { model: garbageModel });
    const run = await runtime.orchestrator.handleEvent(fixture.trigger);
    expect(run.status).toBe('WAITING_REVIEW');
    expect(runtime.tools.calendar.mutationLog).toHaveLength(0);
  });

  it('a forged mutation from an unauthorized sender is blocked deterministically', async () => {
    const forged = EVAL_CORPUS.find((c) => c.name.includes('unauthorized sender'))!;
    const fixture = buildGoldenFixture();
    const outcome = await interpretEmail(
      new FixtureModelClient({ [forged.email.messageId]: forged.expected }),
      forged.email,
      fixture.state,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.failure).toBe('UNVERIFIED_SENDER');
  });
});

describe('commitment-scoped sender authority', () => {
  it('a declared authority domain without an OWNED_BY edge cannot mutate the commitment', async () => {
    const fixture = buildGoldenFixture();
    const state = structuredClone(fixture.state);
    state.edges = state.edges.filter((edge) => edge.type !== 'OWNED_BY');
    const outcome = await interpretEmail(
      new FixtureModelClient({ [fixture.trigger.messageId]: fixture.interpretation }),
      fixture.trigger,
      state,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.failure).toBe('UNVERIFIED_SENDER');
  });

  it('the same sender is accepted once the user-confirmed OWNED_BY edge exists', async () => {
    const fixture = buildGoldenFixture();
    const outcome = await interpretEmail(
      new FixtureModelClient({ [fixture.trigger.messageId]: fixture.interpretation }),
      fixture.trigger,
      fixture.state,
    );
    expect(outcome.ok).toBe(true);
  });
});

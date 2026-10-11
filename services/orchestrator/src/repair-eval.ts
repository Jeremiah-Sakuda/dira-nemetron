import {
  buildReplayRuntime,
  DiraOrchestrator,
  estimateCostUsd,
  FixtureModelClient,
  FixtureRepairModel,
  InMemoryWorkflowStore,
  NemotronModelClient,
  UltraRepairProposer,
  type ModelClient,
  type ModelTier,
  type ReplayFixture,
  type RepairProposal,
} from '@dira/agent';
import { minutesToIso } from '@dira/commitment-model';
import { buildGoldenFixture, IDS, PEOPLE, at, iso, type GoldenVariation } from '@dira/fixtures/golden';
import { buildSecondaryFixture } from '@dira/fixtures/secondary';
import { buildOverlapScenario } from '@dira/fixtures/repair-scenarios';

/**
 * Repair-proposer evaluation (PRD P0.8 evidence). Each scenario runs the full
 * repair loop with Super interpreting the trigger and Ultra proposing plans
 * next to the deterministic enumerator, plus one labeled adversarial probe.
 * External tools are the local stateful simulators, so only the model calls
 * are live; the artifact says so.
 */

export interface RepairEvalScenarioResult {
  name: string;
  status: string;
  interpretation: { model?: string; tier?: string; latencyMs?: number; promptTokens?: number; completionTokens?: number };
  ultra: {
    model?: string;
    latencyMs?: number;
    promptTokens?: number;
    completionTokens?: number;
    proposed: number;
    compiled: number;
    acceptable: number;
    rejectedByStage: Record<string, number>;
    error?: string;
  };
  adversarialProbeRejected: boolean;
  winner: 'nemotron-ultra' | 'deterministic' | 'none';
  selectedPlan?: string;
  finalSlackMin?: number;
}

export interface RepairEvalArtifact {
  generatedAtIso: string;
  mode: 'live' | 'fixture';
  note: string;
  provider: string;
  scenarios: RepairEvalScenarioResult[];
  summary: {
    scenarios: number;
    resolved: number;
    ultraPlansProposed: number;
    ultraPlansCompiled: number;
    ultraPlansAcceptable: number;
    /** Share of Ultra plans that survived provenance, feasibility, margin and policy. */
    ultraValidationRate: number | null;
    /** Share of resolved scenarios whose executed plan came from Ultra. */
    ultraWinShare: number | null;
    adversarialProbesRejected: number;
  };
  usageByTier: Record<string, { calls: number; promptTokens: number; completionTokens: number; costUsd: number; meanLatencyMs: number }>;
  costPerRepairUsd: number | null;
}

interface Scenario {
  name: string;
  fixture: ReplayFixture;
  fixtureProposal: RepairProposal;
}

function goldenProposal(): RepairProposal {
  return {
    plans: [{
      label: 'Later interview slot, stored QA backup, side project after the exam',
      rationale: 'Keeps the recovery buffer and moves only flexible personal time.',
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
}

export function repairEvalScenarios(): Scenario[] {
  const golden = (name: string, variation: GoldenVariation): Scenario => ({
    name, fixture: buildGoldenFixture(variation), fixtureProposal: goldenProposal(),
  });
  const overlap = buildOverlapScenario();
  return [
    golden('48-hour-shock', {}),
    golden('exam-at-1pm', { examHour: 13 }),
    golden('exam-at-3pm', { examHour: 15 }),
    golden('alternate-backup-owner', { backupOwner: 'tunde-adebayo' }),
    golden('shorter-personal-block', { personalBlockDurationMin: 180 }),
    { name: 'recruiter-reschedule', fixture: buildSecondaryFixture(), fixtureProposal: { plans: [] } },
    {
      name: overlap.name,
      fixture: overlap,
      fixtureProposal: {
        plans: [{
          label: 'Move the reading block after the review session',
          rationale: 'The reading block is flexible and 4 PM is free.',
          actions: [{ type: 'MOVE_CALENDAR_EVENT', target: 'reading-block',
            start_iso: minutesToIso(16 * 60, overlap.state.horizonStartIso), new_owner: null, recipient: null,
            provenance: ['policy:flexibility'] }],
        }],
      },
    },
  ];
}

export async function runRepairEval(options: { live: boolean }): Promise<RepairEvalArtifact> {
  if (options.live && !process.env.NEBIUS_API_KEY) {
    throw new Error('NEBIUS_API_KEY is required for the live repair eval. Use --fixture for a credential-free dry run.');
  }
  const results: RepairEvalScenarioResult[] = [];
  const calls: { tier: ModelTier; promptTokens: number; completionTokens: number; latencyMs: number }[] = [];

  for (const scenario of repairEvalScenarios()) {
    const { fixture } = scenario;
    const runtime = await buildReplayRuntime(fixture);
    const interpreter: ModelClient = options.live
      ? new NemotronModelClient()
      : new FixtureModelClient({ [fixture.trigger.messageId]: fixture.interpretation });
    const proposer = new UltraRepairProposer(options.live ? undefined : new FixtureRepairModel(scenario.fixtureProposal));
    const orchestrator = new DiraOrchestrator(
      structuredClone(fixture.state), runtime.tools, runtime.ledger, runtime.recorder, interpreter,
      new InMemoryWorkflowStore(),
      {
        sleep: () => Promise.resolve(),
        repairProposer: proposer,
        adversarialProbe: true,
        facts: {
          messageIds: fixture.inboxSeed.map((message) => message.messageId),
          threadIds: fixture.inboxSeed.map((message) => message.threadId),
        },
      },
    );
    const run = await orchestrator.handleEvent(fixture.trigger);
    const entries = runtime.recorder.all();
    const interpretCall = (entries.find((entry) => entry.phase === 'INTERPRET')?.data as { modelCall?: ModelClient['lastCall'] } | undefined)?.modelCall;
    const proposeEntries = entries.filter((entry) => entry.phase === 'PROPOSE');
    const proposeCalls = proposeEntries
      .map((entry) => (entry.data as { modelCall?: ModelClient['lastCall'] } | undefined)?.modelCall)
      .filter((call): call is NonNullable<ModelClient['lastCall']> => Boolean(call));
    const rejects = entries.filter((entry) => entry.phase === 'REJECT')
      .map((entry) => entry.data as { source: string; stage: string });
    const ultraCandidates = run.planningRounds.flat().filter((candidate) => candidate.source === 'nemotron-ultra');
    const proposed = proposeEntries.reduce((sum, entry) => {
      const match = /proposed (\d+) plan/.exec(entry.message);
      return sum + (match ? Number(match[1]) : 0);
    }, 0);
    const rejectedByStage: Record<string, number> = {};
    for (const reject of rejects.filter((item) => item.source === 'nemotron-ultra')) {
      rejectedByStage[reject.stage] = (rejectedByStage[reject.stage] ?? 0) + 1;
    }
    const selected = run.selectedPlanIds[run.selectedPlanIds.length - 1];
    if (interpretCall && options.live) {
      calls.push({ tier: 'super', promptTokens: interpretCall.promptTokens ?? 0, completionTokens: interpretCall.completionTokens ?? 0, latencyMs: interpretCall.latencyMs });
    }
    for (const call of proposeCalls) {
      if (options.live) calls.push({ tier: 'ultra', promptTokens: call.promptTokens ?? 0, completionTokens: call.completionTokens ?? 0, latencyMs: call.latencyMs });
    }
    const lastPropose = proposeCalls[proposeCalls.length - 1];
    results.push({
      name: scenario.name,
      status: run.status,
      interpretation: {
        model: interpretCall?.model, tier: interpretCall?.tier, latencyMs: interpretCall?.latencyMs,
        promptTokens: interpretCall?.promptTokens, completionTokens: interpretCall?.completionTokens,
      },
      ultra: {
        model: lastPropose?.model,
        latencyMs: lastPropose?.latencyMs,
        promptTokens: proposeCalls.reduce((sum, call) => sum + (call.promptTokens ?? 0), 0),
        completionTokens: proposeCalls.reduce((sum, call) => sum + (call.completionTokens ?? 0), 0),
        proposed,
        compiled: ultraCandidates.length,
        acceptable: ultraCandidates.filter((candidate) => candidate.acceptable).length,
        rejectedByStage,
        error: proposeEntries.find((entry) => entry.message.includes('unavailable'))?.message,
      },
      adversarialProbeRejected: rejects.some((item) => item.source === 'adversarial-probe'),
      winner: run.status === 'RESOLVED' && selected
        ? selected.startsWith('ultra-') ? 'nemotron-ultra' : 'deterministic'
        : 'none',
      selectedPlan: selected,
      finalSlackMin: run.slackFinalMin,
    });
  }

  const proposedTotal = results.reduce((sum, item) => sum + item.ultra.proposed, 0);
  const acceptableTotal = results.reduce((sum, item) => sum + item.ultra.acceptable, 0);
  const resolved = results.filter((item) => item.status === 'RESOLVED');
  const usageByTier: RepairEvalArtifact['usageByTier'] = {};
  for (const call of calls) {
    const bucket = usageByTier[call.tier] ??= { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, meanLatencyMs: 0 };
    bucket.meanLatencyMs = (bucket.meanLatencyMs * bucket.calls + call.latencyMs) / (bucket.calls + 1);
    bucket.calls += 1;
    bucket.promptTokens += call.promptTokens;
    bucket.completionTokens += call.completionTokens;
    bucket.costUsd += estimateCostUsd(call.tier, call.promptTokens, call.completionTokens);
  }
  const totalCost = Object.values(usageByTier).reduce((sum, bucket) => sum + bucket.costUsd, 0);
  return {
    generatedAtIso: new Date().toISOString(),
    mode: options.live ? 'live' : 'fixture',
    note: options.live
      ? 'Model calls are live Nemotron calls on Nebius Token Factory. External tools are Dira\'s local stateful simulators.'
      : 'FIXTURE DRY RUN: no inference was performed. Stored proposals exercise the gates only; this is not model evidence.',
    provider: options.live ? 'Nebius Token Factory' : 'deterministic fixture',
    scenarios: results,
    summary: {
      scenarios: results.length,
      resolved: resolved.length,
      ultraPlansProposed: proposedTotal,
      ultraPlansCompiled: results.reduce((sum, item) => sum + item.ultra.compiled, 0),
      ultraPlansAcceptable: acceptableTotal,
      ultraValidationRate: proposedTotal ? acceptableTotal / proposedTotal : null,
      ultraWinShare: resolved.length ? resolved.filter((item) => item.winner === 'nemotron-ultra').length / resolved.length : null,
      adversarialProbesRejected: results.filter((item) => item.adversarialProbeRejected).length,
    },
    usageByTier,
    costPerRepairUsd: options.live && resolved.length ? totalCost / resolved.length : null,
  };
}

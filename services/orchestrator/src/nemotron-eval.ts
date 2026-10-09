import { NemotronModelClient, interpretEmail } from '@dira/agent';
import { buildGoldenFixture } from '@dira/fixtures/golden';
import { EVAL_CORPUS } from '@dira/fixtures/model-eval';

/** Run the inherited eight-case corpus through live Nemotron and Dira's deterministic gates. */
export interface NemotronEvalCase {
  name: string;
  expectedPipeline: string;
  actualPipeline: 'MUTATION' | 'NO_ACTION' | 'BLOCKED';
  pass: boolean;
  failure?: string;
  entityId?: string;
  mutationType?: string;
  confidence?: number;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  attempts: number;
  checks: { pipeline: boolean; entity: boolean; mutationType: boolean; newStart: boolean };
}

export interface NemotronEvalArtifact {
  generatedAtIso: string;
  provider: 'Nebius Token Factory';
  model: string;
  passed: number;
  total: number;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  cases: NemotronEvalCase[];
}

export async function runNemotronEval(): Promise<NemotronEvalArtifact> {
  const { state } = buildGoldenFixture();
  const client = new NemotronModelClient();
  const cases: NemotronEvalCase[] = [];

  for (const evalCase of EVAL_CORPUS) {
    const outcome = await interpretEmail(client, evalCase.email, state);
    let actual: NemotronEvalCase['actualPipeline'];
    if (!outcome.ok) actual = 'BLOCKED';
    else if (!outcome.result?.relevant || !outcome.result.mutation) actual = 'NO_ACTION';
    else actual = 'MUTATION';

    const expectedMutation = evalCase.expected.mutation;
    const actualMutation = outcome.result?.mutation;
    const safeHold = evalCase.pipelineExpectation === 'SAFE_HOLD' &&
      (actual === 'BLOCKED' || actual === 'NO_ACTION');
    const checks = {
      pipeline: safeHold || actual === evalCase.pipelineExpectation,
      entity: safeHold ? true : expectedMutation
        ? actualMutation?.entity_id === expectedMutation.entity_id
        : actualMutation == null,
      mutationType: safeHold ? true : expectedMutation
        ? actualMutation?.mutation_type === expectedMutation.mutation_type
        : actualMutation == null,
      newStart: safeHold ? true : expectedMutation?.new_start
        ? actualMutation?.new_start === expectedMutation.new_start
        : true,
    };
    const failedChecks = Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name);
    const telemetry = client.lastCall;
    cases.push({
      name: evalCase.name,
      expectedPipeline: evalCase.pipelineExpectation,
      actualPipeline: actual,
      pass: failedChecks.length === 0,
      failure: [outcome.failure, failedChecks.length ? `failed checks: ${failedChecks.join(', ')}` : '']
        .filter(Boolean).join('; ') || undefined,
      entityId: actualMutation?.entity_id,
      mutationType: actualMutation?.mutation_type,
      confidence: actualMutation?.confidence,
      latencyMs: telemetry?.latencyMs,
      promptTokens: telemetry?.promptTokens,
      completionTokens: telemetry?.completionTokens,
      totalTokens: telemetry?.totalTokens,
      attempts: outcome.attempts,
      checks,
    });
  }

  return {
    generatedAtIso: new Date().toISOString(),
    provider: 'Nebius Token Factory',
    model: client.lastCall?.model ?? process.env.DIRA_NEMOTRON_MODEL ?? 'nvidia/nemotron-3-super-120b-a12b',
    passed: cases.filter((item) => item.pass).length,
    total: cases.length,
    usage: {
      promptTokens: cases.reduce((sum, item) => sum + (item.promptTokens ?? 0), 0),
      completionTokens: cases.reduce((sum, item) => sum + (item.completionTokens ?? 0), 0),
      totalTokens: cases.reduce((sum, item) => sum + (item.totalTokens ?? 0), 0),
    },
    cases,
  };
}

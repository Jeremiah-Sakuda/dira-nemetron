import { mkdir, writeFile } from 'node:fs/promises';
import { runRepairEval } from '../services/orchestrator/src/repair-eval.js';

/**
 *   npm run eval:repair             live Super + Ultra on Token Factory → docs/evidence/nemotron-repair-eval.json
 *   npm run eval:repair -- --fixture  credential-free dry run of the gates; prints only, never writes evidence
 */
const fixture = process.argv.includes('--fixture');
const artifact = await runRepairEval({ live: !fixture });
if (!fixture) {
  await mkdir('docs/evidence', { recursive: true });
  await writeFile('docs/evidence/nemotron-repair-eval.json', `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify({
  mode: artifact.mode,
  note: artifact.note,
  summary: artifact.summary,
  usageByTier: artifact.usageByTier,
  costPerRepairUsd: artifact.costPerRepairUsd,
  scenarios: artifact.scenarios.map((s) => `${s.name}: ${s.status} winner=${s.winner} ultra ${s.ultra.acceptable}/${s.ultra.proposed} probeRejected=${s.adversarialProbeRejected}`),
  ...(fixture ? {} : { artifact: 'docs/evidence/nemotron-repair-eval.json' }),
}, null, 2));

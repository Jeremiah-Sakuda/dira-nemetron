import { mkdir, writeFile } from 'node:fs/promises';
import { runNemotronEval } from '../services/orchestrator/src/nemotron-eval.js';

const artifact = await runNemotronEval();
await mkdir('docs/evidence', { recursive: true });
await writeFile('docs/evidence/nemotron-eval.json', `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  provider: artifact.provider,
  model: artifact.model,
  passed: artifact.passed,
  total: artifact.total,
  usage: artifact.usage,
  artifact: 'docs/evidence/nemotron-eval.json',
}, null, 2));

if (artifact.passed !== artifact.total) process.exitCode = 1;

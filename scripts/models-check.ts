import { MODEL_TIERS, tierModel, type ModelTier } from '@dira/agent';

/** Confirm the configured Nemotron ids exist in the live Token Factory catalog. */
const apiKey = process.env.NEBIUS_API_KEY;
if (!apiKey) {
  console.error('NEBIUS_API_KEY is required to list the Token Factory catalog.');
  process.exit(1);
}
const base = (process.env.NEBIUS_TOKEN_FACTORY_BASE_URL ?? 'https://api.tokenfactory.nebius.com/v1').replace(/\/+$/, '');
const response = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
if (!response.ok) {
  console.error(`Token Factory /models failed: HTTP ${response.status}`);
  process.exit(1);
}
const payload = await response.json() as { data?: { id: string }[] };
const ids = new Set((payload.data ?? []).map((model) => model.id));
const nemotron = [...ids].filter((id) => id.toLowerCase().includes('nemotron')).sort();
let missing = 0;
for (const tier of Object.keys(MODEL_TIERS) as ModelTier[]) {
  const configured = tierModel(tier);
  const present = ids.has(configured);
  if (!present) missing += 1;
  console.log(`${tier.padEnd(6)} ${configured} ${present ? 'OK' : 'MISSING'} (${MODEL_TIERS[tier].envVar})`);
}
console.log(`\nNemotron models in the catalog:\n${nemotron.map((id) => `  ${id}`).join('\n')}`);
process.exitCode = missing ? 1 : 0;

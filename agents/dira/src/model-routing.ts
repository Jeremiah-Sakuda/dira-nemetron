/**
 * Nemotron tier routing on Nebius Token Factory. Each job uses the smallest
 * tier that does it well; every call's telemetry carries its tier so the
 * routing cost report can be computed from real usage, not estimates.
 *
 * Prices and ids are from Nebius's Nemotron model page, checked 2026-10-11:
 * https://nebius.com/services/token-factory/models/nvidia-nemotron-models-inference
 * Ids can change; `npm run models:check` lists the live catalog and confirms
 * the configured ids before a deployment.
 */

export type ModelTier = 'nano' | 'super' | 'ultra';

export interface ModelTierConfig {
  tier: ModelTier;
  envVar: string;
  defaultModel: string;
  jobs: string[];
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export const MODEL_TIERS: Record<ModelTier, ModelTierConfig> = {
  nano: {
    tier: 'nano',
    envVar: 'DIRA_NEMOTRON_NANO_MODEL',
    defaultModel: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
    jobs: ['commitment extraction from calendar, email and feed items'],
    inputUsdPerMillion: 0.06,
    outputUsdPerMillion: 0.24,
  },
  super: {
    tier: 'super',
    envVar: 'DIRA_NEMOTRON_MODEL',
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b',
    jobs: ['interpreting a change to an existing commitment'],
    inputUsdPerMillion: 0.30,
    outputUsdPerMillion: 0.90,
  },
  ultra: {
    tier: 'ultra',
    envVar: 'DIRA_NEMOTRON_ULTRA_MODEL',
    defaultModel: 'nvidia/Nemotron-3-Ultra-550b-a55b',
    jobs: ['typed edge proposals', 'structured repair plan proposals'],
    inputUsdPerMillion: 1.0,
    outputUsdPerMillion: 3.0,
  },
};

export const PRICING_SOURCE = {
  url: 'https://nebius.com/services/token-factory/models/nvidia-nemotron-models-inference',
  checkedOn: '2026-10-11',
};

export function tierModel(tier: ModelTier): string {
  const config = MODEL_TIERS[tier];
  return process.env[config.envVar]?.trim() || config.defaultModel;
}

export function tierForModel(model: string): ModelTier | undefined {
  const normalized = model.toLowerCase();
  return (Object.keys(MODEL_TIERS) as ModelTier[]).find((tier) =>
    tierModel(tier).toLowerCase() === normalized || MODEL_TIERS[tier].defaultModel.toLowerCase() === normalized);
}

export function estimateCostUsd(tier: ModelTier, promptTokens = 0, completionTokens = 0): number {
  const config = MODEL_TIERS[tier];
  return (promptTokens * config.inputUsdPerMillion + completionTokens * config.outputUsdPerMillion) / 1_000_000;
}

// One versioned Secret Manager value carries backend-only configuration.
// Expand it before importing modules that read configuration at startup.
export {};
const raw = process.env.DIRA_CONFIG_JSON;
if (raw) {
  let config: unknown;
  try { config = JSON.parse(raw); } catch { throw new Error('Invalid backend configuration JSON.'); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid backend configuration object.');
  for (const [key, value] of Object.entries(config)) {
    if (!/^(DIRA_[A-Z0-9_]+|GOOGLE_[A-Z0-9_]+|NEBIUS_[A-Z0-9_]+|DATABASE_URL|TAVILY_API_KEY)$/.test(key)
      || typeof value !== 'string') throw new Error('Unsupported backend configuration field.');
    process.env[key] = value;
  }
  delete process.env.DIRA_CONFIG_JSON;
}
await import('./main.js');

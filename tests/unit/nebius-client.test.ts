import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NemotronModelClient } from '../../agents/dira/src/interpreter.js';
import { GraphEdgeBuilder } from '../../agents/dira/src/edge-builder.js';
import { buildGoldenFixture } from '@dira/fixtures/golden';

const endpoint = 'https://api.tokenfactory.nebius.com/v1';
const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
const completion = (finish_reason = 'stop') => new Response(JSON.stringify({
  model: 'nvidia/nemotron-3-super-120b-a12b',
  choices: [{ finish_reason, message: { content: '{"ok":true}' } }],
  usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
}), { status: 200 });
const client = () => new NemotronModelClient(undefined, endpoint, 'test-key');

beforeEach(() => {
  vi.stubEnv('DIRA_MODEL_MAX_OUTPUT_TOKENS', '4096');
  vi.stubEnv('DIRA_MODEL_MAX_REQUEST_BYTES', '131072');
  vi.stubEnv('DIRA_MODEL_MAX_ATTEMPTS', '1');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Nebius client request and failure boundaries', () => {
  it('sends bounded structured output and records real response telemetry', async () => {
    const fetcher = vi.fn().mockResolvedValue(completion());
    vi.stubGlobal('fetch', fetcher);
    const model = client();
    expect(await model.generateStructured('synthetic prompt', 'test', schema)).toEqual({ ok: true });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(`${endpoint}/chat/completions`);
    const body = JSON.parse(init.body);
    expect(body.max_tokens).toBe(4096);
    expect(body.response_format.json_schema.schema).toEqual(schema);
    expect(init.redirect).toBe('error');
    expect(model.lastCall).toMatchObject({ provider: 'Nebius Token Factory', promptTokens: 12, completionTokens: 8 });
  });

  it.each(['length', 'content_filter', 'tool_calls'])('rejects %s even with parseable JSON', async (reason) => {
    const fetcher = vi.fn().mockResolvedValue(completion(reason));
    vi.stubGlobal('fetch', fetcher);
    const model = client();
    await expect(model.generateStructured('prompt', 'test', schema)).rejects.toThrow('incomplete');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(model.lastCall?.completionTokens).toBe(8);
  });

  it('does not retry 401 or disclose the provider error body', async () => {
    vi.stubEnv('DIRA_MODEL_MAX_ATTEMPTS', '3');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'private prompt 500' } }), { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(client().generateStructured('prompt', 'test', schema)).rejects.toThrow(/^Token Factory inference failed \(HTTP 401\)$/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('bounds transport retries and can recover from a 503', async () => {
    vi.useFakeTimers();
    vi.stubEnv('DIRA_MODEL_MAX_ATTEMPTS', '2');
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(completion());
    vi.stubGlobal('fetch', fetcher);
    const result = client().generateStructured('prompt', 'test', schema);
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid limits before making a request', async () => {
    vi.stubEnv('DIRA_MODEL_MAX_OUTPUT_TOKENS', '0');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(client().generateStructured('prompt', 'test', schema)).rejects.toThrow('DIRA_MODEL_MAX_OUTPUT_TOKENS');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('counts schema and UTF-8 bytes in the request bound', async () => {
    vi.stubEnv('DIRA_MODEL_MAX_REQUEST_BYTES', '300');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(client().generateStructured('é'.repeat(200), 'test', schema)).rejects.toThrow('MAX_REQUEST_BYTES');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses to send credentials over HTTP', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const model = new NemotronModelClient(undefined, 'http://api.tokenfactory.nebius.com/v1', 'test-key');
    await expect(model.generateStructured('prompt', 'test', schema)).rejects.toThrow('HTTPS');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps a missing key local', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const model = new NemotronModelClient(undefined, endpoint, '');
    await expect(model.generateStructured('prompt', 'test', schema)).rejects.toThrow('NEBIUS_API_KEY');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the configured Ultra model for graph edges without a misspelled override', async () => {
    vi.stubEnv('DIRA_NEMOTRON_ULTRA_MODEL', 'custom-ultra');
    vi.stubEnv('NEBIUS_API_KEY', 'test-key');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: 'custom-ultra', choices: [{ finish_reason: 'stop', message: { content: '{"edges":[]}' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const result = await new GraphEdgeBuilder().propose(buildGoldenFixture().state);
    expect(result.edges).toEqual([]);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).model).toBe('custom-ultra');
  });
});

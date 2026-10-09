import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { FileLedgerStore } from '@dira/action-ledger/file-store';
import { buildReplayRuntime, computeRunMetrics } from '@dira/agent';
import { FileWorkflowStore } from '@dira/agent/file-stores';
import { Gemma3nVoiceClient, transcriptToVoiceEvent } from '@dira/gemma-voice';
import { RawEmailEventSchema, RawVoiceNoteSchema } from '@dira/event-schema';
import { buildGoldenFixture, type GoldenVariation } from '@dira/fixtures/golden';

/**
 * dira-orchestrator — the single Cloud Run service hosting Dira's repair
 * loop (PRD §31). Deployed with REPLAY_MODE=production it runs the REAL
 * path: Nebius Token Factory Nemotron interpretation, Firestore ledger/state, Google
 * Calendar mutations, controlled recruiter/org integrations.
 *
 * Endpoints
 *   GET  /health             liveness (/healthz is intercepted by GFE on run.app)
 *   GET  /status             seeded? calendar id, doc counts (production)
 *   POST /events             normalized RawEmailEvent (Pub/Sub push or webhook)
 *   POST /voice-notes        Gemma 3n transcription → owner-scoped voice event
 *   POST /demo/reset         reseed the demo world (body: optional variation)
 *   POST /demo/trigger       inject the golden professor email
 *   GET  /runs/latest        latest workflow run + flight recording
 *   GET  /eval/nemotron      run the model-eval corpus against Token Factory
 *   GET  /eval/gemini        run the historical v1 corpus against Gemini
 *
 * The demo deployment pins max-instances=1; multi-worker safety is provided
 * by the Firestore ledger's transactional claims when that cap is lifted.
 */

const PORT = Number(process.env.PORT ?? 8081);
const MODE =
  process.env.REPLAY_MODE === 'production'
    ? 'production'
    : process.env.REPLAY_MODE === 'live-model'
      ? 'live-model'
      : 'deterministic';
const DATA_DIR = process.env.DIRA_DATA_DIR ?? '.dira-runtime';
const DEMO_TOKEN = process.env.DIRA_DEMO_TOKEN ?? '';
const ALLOWED_ORIGIN = process.env.DIRA_ALLOWED_ORIGIN ?? 'http://localhost:3000';
const GEMMA3N_URL = process.env.DIRA_GEMMA3N_URL ?? '';
const GEMMA3N_TOKEN = process.env.DIRA_GEMMA3N_TOKEN ?? '';

if (MODE === 'production' && !DEMO_TOKEN) {
  throw new Error('DIRA_DEMO_TOKEN is required in production mode');
}

function cors(req: IncomingMessage, res: ServerResponse): void {
  if (req.headers.origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-dira-demo-token');
}

function json(req: IncomingMessage, res: ServerResponse, code: number, body: unknown): void {
  cors(req, res);
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage): boolean {
  if (MODE !== 'production') return true;
  const supplied = String(req.headers['x-dira-demo-token'] ?? '');
  if (!supplied || supplied.length !== DEMO_TOKEN.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(DEMO_TOKEN));
}

function requireAuthorization(req: IncomingMessage, res: ServerResponse): boolean {
  if (authorized(req)) return true;
  json(req, res, 401, { error: 'unauthorized' });
  return false;
}

function gemmaVoiceClient(): Gemma3nVoiceClient {
  if (!GEMMA3N_URL) {
    throw new Error('Gemma 3n voice intake is not configured');
  }
  return new Gemma3nVoiceClient({ endpointUrl: GEMMA3N_URL, token: GEMMA3N_TOKEN || undefined });
}

const readBody = (req: NodeJS.ReadableStream): Promise<string> =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });

const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/**
 * The production demo is ONE shared world (one calendar, one Firestore
 * state). Concurrent judges must never interleave reseeds with in-flight
 * runs, so every world-touching operation is serialized through this queue;
 * later arrivals wait their turn, and a bounded queue turns pile-ups into a
 * polite 429 instead of corrupted runs.
 */
class BusyError extends Error {
  override name = 'BusyError';
}
let worldChain: Promise<unknown> = Promise.resolve();
let worldQueueDepth = 0;
const WORLD_MAX_QUEUE = 2;
const isWorldBusy = () => worldQueueDepth > 0;
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  if (worldQueueDepth > WORLD_MAX_QUEUE) {
    throw new BusyError('demo world busy: too many queued runs');
  }
  worldQueueDepth++;
  const result = worldChain.then(fn).finally(() => {
    worldQueueDepth--;
  });
  worldChain = result.catch(() => {});
  return result;
}

async function handleLocalEvent(raw: unknown) {
  const parsed = RawEmailEventSchema.parse(raw);
  const fixture = buildGoldenFixture();
  const runtime = await buildReplayRuntime(fixture, {
    mode: MODE === 'live-model' ? 'live-model' : 'deterministic',
    ledgerStore: new FileLedgerStore(`${DATA_DIR}/ledger.json`),
    workflowStore: new FileWorkflowStore(`${DATA_DIR}/workflows.json`),
  });
  const run = await runtime.orchestrator.handleEvent(parsed);
  return { run, metrics: computeRunMetrics(run, runtime.ledger), flight: runtime.recorder.all() };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (req.method === 'OPTIONS') {
      cors(req, res);
      res.writeHead(204).end();
      return;
    }
    // Google Frontend intercepts /healthz on run.app URLs before it reaches
    // the container, so the public liveness path is /health (both work
    // locally).
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
      json(req, res, 200, { ok: true, mode: MODE });
      return;
    }

    if (MODE === 'production') {
      const production = await import('./production.js');

      if (req.method === 'GET' && url.pathname === '/status') {
        json(req, res, 200, { mode: MODE, ...(await production.productionStatus()) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/demo/reset') {
        if (!requireAuthorization(req, res)) return;
        const body = (safeJson(await readBody(req)) ?? {}) as GoldenVariation;
        const seeded = await serialized(() => production.seedProduction(body));
        json(req, res, 200, { reseeded: true, ...seeded });
        return;
      }
      if (req.method === 'POST' && (url.pathname === '/events' || url.pathname === '/demo/trigger')) {
        if (!requireAuthorization(req, res)) return;
        let raw = safeJson(await readBody(req));
        if (url.pathname === '/demo/trigger') {
          // Controlled webhook: inject the golden professor email, optionally
          // varied (?examHour=13|14|15) — the runtime variable for the video.
          // Demo runs get a unique eventId per injection so a stale
          // processing lease from a dead run can never wedge new demos
          // (webhook /events keeps the caller's id: real dedup semantics).
          const examHour = Number(url.searchParams.get('examHour') ?? 14) as 13 | 14 | 15;
          const fixtureTrigger = buildGoldenFixture({ examHour }).trigger;
          raw = { ...fixtureTrigger, eventId: `${fixtureTrigger.eventId}-${Date.now()}` };
        } else if ((raw as { message?: { data?: string } })?.message?.data) {
          // Pub/Sub push envelope
          raw = safeJson(
            Buffer.from((raw as { message: { data: string } }).message.data, 'base64').toString('utf8'),
          );
        }
        const trigger = RawEmailEventSchema.parse(raw);
        const result = await serialized(() => production.handleProductionEvent(trigger));
        console.log(
          JSON.stringify({
            severity: 'INFO',
            msg: 'workflow finished',
            run: result.run.id,
            status: result.run.status,
            modelCall: result.modelCall,
          }),
        );
        json(req, res, 200, result);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/voice-notes') {
        if (!requireAuthorization(req, res)) return;
        const note = RawVoiceNoteSchema.parse(safeJson(await readBody(req)));
        const transcription = await gemmaVoiceClient().transcribe(note);
        const trigger = transcriptToVoiceEvent(note, transcription);
        const result = await serialized(() => production.handleProductionEvent(trigger));
        console.log(JSON.stringify({
          severity: 'INFO',
          msg: 'Gemma 3n voice workflow finished',
          run: result.run.id,
          status: result.run.status,
          gemma3n: { model: transcription.model, latencyMs: transcription.latencyMs },
          modelCall: result.modelCall,
        }));
        json(req, res, 200, {
          ...result,
          gemma3n: { model: transcription.model, latencyMs: transcription.latencyMs },
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/demo/stream') {
        if (!requireAuthorization(req, res)) return;
        // Scenario variation arrives as URI-encoded JSON; the reseed happens
        // INSIDE this stream's serialized turn, so a judge's run can never be
        // wiped by another judge's reset, and the seeding phase is narrated
        // instead of appearing as dead air.
        let variation: GoldenVariation = {};
        const variationRaw = url.searchParams.get('variation');
        if (variationRaw) {
          variation = (safeJson(variationRaw) ?? {}) as GoldenVariation;
        } else if (url.searchParams.get('examHour')) {
          variation = { examHour: Number(url.searchParams.get('examHour')) as 13 | 14 | 15 };
        }
        const fixtureTrigger = buildGoldenFixture(variation).trigger;
        // Unique per-run eventId: a stale lease from a dead run must never
        // wedge the next judge's demo.
        const trigger = { ...fixtureTrigger, eventId: `${fixtureTrigger.eventId}-${Date.now()}` };
        cors(req, res);
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
        });
        const send = (event: string, data: unknown) => {
          if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        let syntheticSeq = 0;
        const note = (message: string) => ({
          seq: --syntheticSeq,
          atIso: new Date().toISOString(),
          phase: 'EVENT',
          message,
        });
        try {
          if (isWorldBusy()) {
            send('entry', note('Another run is in flight on the shared demo world — this run is queued and starts automatically.'));
          }
          const result = await serialized(async () => {
            send('entry', note('Reseeding the demo world (Firestore state + real Google Calendar)…'));
            const seeded = await production.seedProduction(variation);
            send('entry', note(`World reseeded: ${seeded.seededEvents} calendar events restored, scenario applied.`));
            return production.handleProductionEvent(trigger, (entry) => send('entry', entry));
          });
          // Structured completion log so the streamed run — the path the
          // dashboard actually uses — is tie-able by workflow ID to the UI
          // result and the Firestore ledger.
          console.log(JSON.stringify({
            severity: 'INFO',
            msg: 'workflow finished',
            run: result.run.id,
            status: result.run.status,
            modelCall: result.modelCall,
            path: '/demo/stream',
          }));
          send('done', {
            status: result.run.status,
            statusReason: result.run.statusReason,
            // The workflow ID ties this on-screen result to the Cloud Run
            // structured log and the Firestore ledger/workflow_runs doc.
            workflowId: result.run.id,
            slackBeforeMin: result.run.slackBeforeMin,
            slackAfterMutationMin: result.run.slackAfterMutationMin,
            slackFinalMin: result.run.slackFinalMin,
            failuresRecovered: result.run.failuresRecovered,
            userInterventions: result.run.userInterventions,
            runtime: 'production',
            modelCall: result.modelCall,
            calendarId: result.calendarId,
            changes: result.changes,
          });
        } catch (err) {
          send('error', { message: friendlyError(err) });
        } finally {
          res.end();
        }
        return;
      }
      if (req.method === 'GET' && url.pathname === '/runs/latest') {
        if (!requireAuthorization(req, res)) return;
        const latest = await production.latestProductionRun();
        if (!latest) {
          json(req, res, 404, { error: 'no runs yet' });
          return;
        }
        json(req, res, 200, latest);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/eval/gemini') {
        if (!requireAuthorization(req, res)) return;
        const { runGeminiEval } = await import('./gemini-eval.js');
        json(req, res, 200, await runGeminiEval());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/eval/nemotron') {
        if (!requireAuthorization(req, res)) return;
        const { runNemotronEval } = await import('./nemotron-eval.js');
        json(req, res, 200, await runNemotronEval());
        return;
      }
    } else {
      if (req.method === 'GET' && url.pathname === '/status') {
        json(req, res, 200, { mode: MODE, seeded: true, local: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/events') {
        const raw = safeJson(await readBody(req));
        json(req, res, 200, await handleLocalEvent(raw));
        return;
      }
    }

    json(req, res, 404, { error: 'not found' });
  } catch (err) {
    console.error(JSON.stringify({ severity: 'ERROR', msg: String(err) }));
    const code =
      err instanceof Error && err.name === 'EventAlreadyProcessingError'
        ? 409
        : err instanceof BusyError
          ? 429
          : 500;
    json(req, res, code, { error: friendlyError(err) });
  }
});

function friendlyError(err: unknown): string {
  if (err instanceof BusyError) {
    return 'The shared demo world is busy with queued runs — try again in about a minute.';
  }
  if (err instanceof Error && err.name === 'EventAlreadyProcessingError') {
    return 'This event is already being processed by another run — wait for it to finish, then run again.';
  }
  return String(err);
}

server.listen(PORT, () => console.log(`dira-orchestrator listening on :${PORT} (mode: ${MODE})`));

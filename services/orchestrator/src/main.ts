import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { ActionLedger } from '@dira/action-ledger';
import { FileLedgerStore } from '@dira/action-ledger/file-store';
import { buildReplayRuntime, computeRunMetrics } from '@dira/agent';
import { FileWorkflowStore } from '@dira/agent/file-stores';
import { Gemma3nVoiceClient, transcriptToVoiceEvent } from '@dira/gemma-voice';
import { RawEmailEventSchema, RawVoiceNoteSchema } from '@dira/event-schema';
import { buildGoldenFixture, type GoldenVariation } from '@dira/fixtures/golden';
import { beginGoogleOAuth, clearSessionCookie, completeGoogleOAuth, getSessionAccountId, googleCalendarWriteEnabled, isAllowedOrigin } from './google-auth.js';
import { PostgresAccountStore, PostgresLedgerStore, PostgresWorkflowStore } from './postgres-store.js';
import { googleAccessToken } from './google-auth.js';
import { GoogleUserCalendarTool } from '@dira/adapter-calendar/user-google';
import { CalendarGraphBuilder, GraphEdgeBuilder, GraphEdgeDataEditsSchema, GraphProposalEditsSchema, type WorkflowRun } from '@dira/agent';
import { analyzeAccountSchedule, AvailabilityProfileSchema, prepareAccountSchedule, stableActionIntentKey } from './account-planning.js';
import { revalidateAccountApproval } from './account-approval.js';
import { resumeApprovedAccountWorkflow } from './account-broker.js';
import { exportAccountMemory, syncAccountMemory } from './account-memory.js';

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
let accountStorePromise: Promise<PostgresAccountStore> | undefined;

if (MODE === 'production' && !DEMO_TOKEN) {
  throw new Error('DIRA_DEMO_TOKEN is required in production mode');
}

function cors(req: IncomingMessage, res: ServerResponse): void {
  const allowedOrigin = process.env.DIRA_WEB_ORIGIN ?? ALLOWED_ORIGIN;
  if (req.headers.origin === allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-dira-demo-token');
}

function accountStore(): Promise<PostgresAccountStore> {
  accountStorePromise ??= (async () => {
    const store = new PostgresAccountStore();
    await store.initialize();
    return store;
  })();
  return accountStorePromise;
}

async function syncMemoryFromStore(store: PostgresAccountStore, accountId: string): Promise<void> {
  try {
    const [state, profile] = await Promise.all([
      store.ensureDomainState(accountId),
      store.getAvailabilityProfile(accountId),
    ]);
    await syncAccountMemory(accountId, state, profile);
  } catch (error) {
    console.error('account memory mirror sync failed', error);
  }
}

async function syncMemoryFromStoreStrict(store: PostgresAccountStore, accountId: string): Promise<void> {
  const [state, profile] = await Promise.all([
    store.ensureDomainState(accountId),
    store.getAvailabilityProfile(accountId),
  ]);
  await syncAccountMemory(accountId, state, profile);
}

function json(req: IncomingMessage, res: ServerResponse, code: number, body: unknown): void {
  cors(req, res);
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'private, no-store' });
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

    if (req.method === 'GET' && url.pathname === '/auth/google/start') {
      const start = beginGoogleOAuth();
      res.writeHead(302, { location: start.authorizationUrl, 'set-cookie': start.stateCookie });
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/auth/google/calendar-write/start') {
      const accountId = getSessionAccountId(req);
      if (!accountId) {
        json(req, res, 401, { error: 'unauthenticated' });
        return;
      }
      const start = beginGoogleOAuth({ accountId, calendarWrite: true });
      res.writeHead(302, { location: start.authorizationUrl, 'set-cookie': start.stateCookie });
      res.end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/auth/google/complete') {
      const body = safeJson(await readBody(req)) as { code?: string; state?: string } | null;
      if (!body?.code || !body.state) {
        json(req, res, 400, { error: 'missing_code_or_state' });
        return;
      }
      const complete = await completeGoogleOAuth(req, body.code, body.state, await accountStore());
      await syncMemoryFromStore(await accountStore(), complete.accountId);
      json(req, res, 200, {
        accountId: complete.accountId,
        sessionCookie: complete.sessionCookie,
        clearStateCookie: complete.clearStateCookie,
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/auth/google/callback') {
      const googleError = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (googleError || !code || !state) {
        res.writeHead(302, {
          location: `${process.env.DIRA_WEB_ORIGIN ?? ALLOWED_ORIGIN}/?auth_error=google`,
          'set-cookie': `dira_oauth_state=; Path=/auth/google; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
        });
        res.end();
        return;
      }
      const complete = await completeGoogleOAuth(req, code, state, await accountStore());
      await syncMemoryFromStore(await accountStore(), complete.accountId);
      res.writeHead(302, {
        location: `${process.env.DIRA_WEB_ORIGIN ?? ALLOWED_ORIGIN}/?signed_in=1`,
        'set-cookie': [complete.sessionCookie, complete.clearStateCookie],
      });
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/me') {
      const accountId = getSessionAccountId(req);
      if (!accountId) {
        json(req, res, 401, { error: 'unauthenticated' });
        return;
      }
      const store = await accountStore();
      const account = await store.getAccount(accountId);
      if (!account) {
        json(req, res, 401, { error: 'account_not_found' });
        return;
      }
      const [state, credential] = await Promise.all([
        store.ensureDomainState(accountId),
        store.getCredential(accountId, 'google'),
      ]);
      await syncMemoryFromStore(store, accountId);
      json(req, res, 200, {
        account,
        permissions: {
          calendarWrite: credential?.scopes.includes('https://www.googleapis.com/auth/calendar.events') ?? false,
        },
        stateSummary: {
          commitmentCount: Object.keys(state.commitments).length,
          edgeCount: state.edges.length,
          timezone: state.timezone,
          horizonEndMin: state.horizonEndMin,
        },
      });
      return;
    }
    if (url.pathname === '/api/availability' && req.method === 'GET') {
      const accountId = getSessionAccountId(req);
      if (!accountId) {
        json(req, res, 401, { error: 'unauthenticated' });
        return;
      }
      json(req, res, 200, { profile: await (await accountStore()).getAvailabilityProfile(accountId) ?? null });
      return;
    }
    if (url.pathname === '/api/memory/export' && req.method === 'GET') {
      const accountId = getSessionAccountId(req);
      if (!accountId) {
        json(req, res, 401, { error: 'unauthenticated' });
        return;
      }
      try {
        const store = await accountStore();
        await syncMemoryFromStoreStrict(store, accountId);
        const bundle = await exportAccountMemory(accountId);
        cors(req, res);
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename="dira-memory.bundle"',
          'content-length': bundle.length,
          'cache-control': 'private, no-store',
        });
        res.end(bundle);
      } catch (error) {
        json(req, res, 503, { error: error instanceof Error ? error.message : 'memory_export_unavailable' });
      }
      return;
    }
    if (url.pathname === '/api/availability' && req.method === 'POST') {
      if (!isAllowedOrigin(req.headers.origin)) {
        json(req, res, 403, { error: 'origin_not_allowed' });
        return;
      }
      const accountId = getSessionAccountId(req);
      if (!accountId) {
        json(req, res, 401, { error: 'unauthenticated' });
        return;
      }
      const parsed = AvailabilityProfileSchema.safeParse(safeJson(await readBody(req)));
      if (!parsed.success) {
        json(req, res, 400, { error: 'invalid_availability_profile', issues: parsed.error.issues });
        return;
      }
      const store = await accountStore();
      await store.ensureDomainState(accountId);
      await store.saveAvailabilityProfile(accountId, parsed.data);
      const state = await store.loadDomainState(accountId);
      if (state) {
        try {
          await syncAccountMemory(accountId, state, parsed.data);
        } catch (error) {
          console.error('account memory mirror sync failed', error);
        }
      }
      json(req, res, 200, { saved: true, profile: parsed.data, focusWindows: state?.availability.length ?? 0 });
      return;
    }
    if (url.pathname === '/api/graph/analysis' && req.method === 'GET') {
      const accountId = getSessionAccountId(req);
      if (!accountId) {
        json(req, res, 401, { error: 'unauthenticated' });
        return;
      }
      const store = await accountStore();
      const profile = await store.getAvailabilityProfile(accountId);
      if (!profile) {
        json(req, res, 409, { error: 'Set your focus hours before checking schedule feasibility.' });
        return;
      }
      const state = await store.ensureDomainState(accountId);
      json(req, res, 200, analyzeAccountSchedule(state));
      return;
    }
    if (url.pathname === '/api/graph/analysis' && req.method === 'POST') {
      if (!isAllowedOrigin(req.headers.origin)) {
        json(req, res, 403, { error: 'origin_not_allowed' });
        return;
      }
      const accountId = getSessionAccountId(req);
      if (!accountId) {
        json(req, res, 401, { error: 'unauthenticated' });
        return;
      }
      const body = safeJson(await readBody(req)) as { planId?: string } | null;
      if (typeof body?.planId !== 'string' || body.planId.length < 1 || body.planId.length > 200) {
        json(req, res, 400, { error: 'invalid_plan_id' });
        return;
      }
      const store = await accountStore();
      if (!await store.getAvailabilityProfile(accountId)) {
        json(req, res, 409, { error: 'Set your focus hours before requesting plan approval.' });
        return;
      }
      const state = await store.ensureDomainState(accountId);
      const prepared = prepareAccountSchedule(state);
      const validation = prepared.ranked.find((candidate) => candidate.plan.id === body.planId);
      if (!validation || !validation.acceptable) {
        json(req, res, 409, { error: 'The selected plan is no longer feasible. Check the schedule again.' });
        return;
      }
      const denied = validation.policy.decisions.find((decision) => decision.verdict === 'DENY');
      if (denied) {
        json(req, res, 409, { error: `Policy does not allow this action: ${denied.reason}` });
        return;
      }
      const planActions = validation.plan.actions
        .map((action, index) => ({ action, decision: validation.policy.decisions[index]! }))
      const pending = planActions
        .filter(({ decision }) => decision.verdict === 'REQUIRE_APPROVAL');
      if (pending.length === 0) {
        json(req, res, 409, { error: 'This plan has no approval-required actions.' });
        return;
      }

      const eventId = `account-plan-${randomUUID()}`;
      const workflowId = `wf-${eventId}`;
      const requestedAtIso = new Date().toISOString();
      const ledger = await ActionLedger.open(new PostgresLedgerStore(store, accountId));
      const existingPendingKeys = new Set(ledger.all()
        .filter((record) => ['AWAITING_APPROVAL', 'AUTHORIZED', 'PENDING_EXECUTION', 'EXECUTING', 'EXECUTED_UNVERIFIED', 'FAILED_TRANSIENT'].includes(record.status))
        .map((record) => stableActionIntentKey(record.action)));
      if (planActions.some(({ action }) => existingPendingKeys.has(stableActionIntentKey(action)))) {
        json(req, res, 409, { error: 'A matching action is already awaiting approval or authorized.' });
        return;
      }
      const actionIds: string[] = [];
      for (const [index, { action, decision }] of planActions.entries()) {
        const persisted = await ledger.persistIntent(
          workflowId,
          action,
          decision.verdict,
          decision.rule,
          { planId: validation.plan.id, seq: index },
        );
        if (persisted.record.status === 'PLANNED') {
          if (decision.verdict === 'REQUIRE_APPROVAL') {
            const awaiting = await ledger.transition(persisted.record.actionId, 'AWAITING_APPROVAL', {
              approval: { requestedAtIso },
            }, 'feasible plan held for authenticated account-owner decision');
            actionIds.push(awaiting.actionId);
          } else {
            await ledger.transition(persisted.record.actionId, 'AUTHORIZED', {}, 'deterministic policy permits this action; held until the plan approvals are complete');
          }
        } else if (persisted.record.status === 'AWAITING_APPROVAL' && decision.verdict === 'REQUIRE_APPROVAL') {
          actionIds.push(persisted.record.actionId);
        }
      }
      if (actionIds.length === 0) {
        json(req, res, 409, { error: 'The selected plan already has a terminal action record.' });
        return;
      }
      const run: WorkflowRun = {
        id: workflowId,
        eventId,
        status: 'AWAITING_APPROVAL',
        statusReason: 'A feasible schedule plan contains action(s) requiring the account owner’s approval.',
        mutationSummary: `Schedule review: ${validation.plan.label}`,
        impacts: [],
        affected: [],
        planningRounds: [[{
          id: validation.plan.id,
          label: validation.plan.label,
          acceptable: false,
          autonomous: false,
          costTotal: validation.cost.total,
          slackMinutes: validation.feasibility.global_slack_minutes,
          rejectionReason: 'Awaiting authenticated account-owner approval.',
          actionCount: validation.plan.actions.length,
        }]],
        selectedPlanIds: [validation.plan.id],
        failuresRecovered: 0,
        replans: 0,
        userInterventions: 0,
      };
      await new PostgresWorkflowStore(store, accountId).save(run);
      json(req, res, 202, { workflowId, status: run.status, approvalCount: actionIds.length, actionIds });
      return;
    }
    if (url.pathname === '/api/approvals' && req.method === 'GET') {
      const accountId = getSessionAccountId(req);
      if (!accountId) {
        json(req, res, 401, { error: 'unauthenticated' });
        return;
      }
      const approvals = await (await accountStore()).listPendingApprovals(accountId);
      const store = await accountStore();
      json(req, res, 200, {
        approvals: approvals.map((record) => ({
          actionId: record.actionId,
          workflowId: record.workflowId,
          type: record.action.type,
          target: record.action.target,
          summary: record.action.summary,
          externalSystem: record.action.external_system,
          policyRule: record.policyRule,
          requestedAtIso: record.approval?.requestedAtIso
            ?? record.history.find((entry) => entry.status === 'AWAITING_APPROVAL')?.atIso,
        })),
        recentDecisions: await (await accountStore()).listRecentApprovalDecisions(accountId),
        resumableWorkflows: await store.listResumableApprovalWorkflows(accountId),
      });
      return;
    }
    if (url.pathname === '/api/approvals/resume' && req.method === 'POST') {
      if (!isAllowedOrigin(req.headers.origin)) {
        json(req, res, 403, { error: 'origin_not_allowed' });
        return;
      }
      const accountId = getSessionAccountId(req);
      if (!accountId) {
        json(req, res, 401, { error: 'unauthenticated' });
        return;
      }
      const body = safeJson(await readBody(req)) as { workflowId?: string } | null;
      if (typeof body?.workflowId !== 'string' || body.workflowId.length < 1 || body.workflowId.length > 500) {
        json(req, res, 400, { error: 'invalid_workflow_id' });
        return;
      }
      const store = await accountStore();
      try {
        const result = await resumeApprovedAccountWorkflow(store, accountId, body.workflowId, () => googleAccessToken(store, accountId));
        await syncMemoryFromStore(store, accountId);
        json(req, res, 200, result);
      } catch (error) {
        json(req, res, 409, { error: error instanceof Error ? error.message : 'workflow_resume_conflict' });
      }
      return;
    }
    if (url.pathname === '/api/approvals' && req.method === 'POST') {
      if (!isAllowedOrigin(req.headers.origin)) {
        json(req, res, 403, { error: 'origin_not_allowed' });
        return;
      }
      const accountId = getSessionAccountId(req);
      if (!accountId) {
        json(req, res, 401, { error: 'unauthenticated' });
        return;
      }
      const body = safeJson(await readBody(req)) as { actionId?: string; decision?: string } | null;
      if (typeof body?.actionId !== 'string' || body.actionId.length < 1 || body.actionId.length > 500
        || (body.decision !== 'APPROVED' && body.decision !== 'REJECTED')) {
        json(req, res, 400, { error: 'invalid_approval_decision' });
        return;
      }
      try {
        const store = await accountStore();
        if (body.decision === 'APPROVED' && !await googleCalendarWriteEnabled(store, accountId)) {
          json(req, res, 409, { error: 'Enable Google Calendar changes in Account setup before approving this plan.' });
          return;
        }
        const revalidation = body.decision === 'APPROVED'
          ? await revalidateAccountApproval(store, accountId, body.actionId, () => googleAccessToken(store, accountId))
          : undefined;
        if (revalidation && !revalidation.ok) {
          json(req, res, 409, { error: revalidation.reason, refreshSchedule: true });
          return;
        }
        const record = await store.reviewActionApproval(
          accountId,
          body.actionId,
          body.decision,
          revalidation?.ok ? revalidation.evidence : undefined,
        );
        let execution: { status: string; verifiedActions: number; reason?: string } | undefined;
        if (body.decision === 'APPROVED') {
          const workflowRecords = await store.listWorkflowActionRecords(accountId, record.workflowId);
          if (workflowRecords.every((item) => item.status === 'AUTHORIZED')) {
            execution = await resumeApprovedAccountWorkflow(
              store, accountId, record.workflowId, () => googleAccessToken(store, accountId),
            );
          }
        }
        await syncMemoryFromStore(store, accountId);
        json(req, res, 200, {
          actionId: record.actionId,
          status: record.status,
          decision: body.decision,
          revalidatedAtIso: record.approval?.revalidatedAtIso,
          checkedCalendarEvents: revalidation?.ok ? revalidation.checkedCalendarEvents : 0,
          planLabel: revalidation?.ok ? revalidation.planLabel : undefined,
          execution: execution ?? { status: body.decision === 'APPROVED' ? 'AWAITING_APPROVAL' : 'REJECTED', verifiedActions: 0 },
        });
      } catch (error) {
        json(req, res, 409, { error: error instanceof Error ? error.message : 'approval_conflict' });
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/calendar/events') {
      const accountId = getSessionAccountId(req);
      if (!accountId) {
        json(req, res, 401, { error: 'unauthenticated' });
        return;
      }
      const store = await accountStore();
      const account = await store.getAccount(accountId);
      if (!account) {
        json(req, res, 401, { error: 'account_not_found' });
        return;
      }
      const calendar = new GoogleUserCalendarTool(() => googleAccessToken(store, accountId));
      json(req, res, 200, { timezone: account.timezone, events: await calendar.getEvents() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/graph/proposals') {
      const accountId = getSessionAccountId(req);
      if (!accountId) {
        json(req, res, 401, { error: 'unauthenticated' });
        return;
      }
      const proposals = await (await accountStore()).listGraphProposals(accountId, 'PENDING_REVIEW');
      json(req, res, 200, { proposals });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/graph/proposals') {
      const accountId = getSessionAccountId(req);
      if (!accountId) {
        json(req, res, 401, { error: 'unauthenticated' });
        return;
      }
      const store = await accountStore();
      const account = await store.getAccount(accountId);
      if (!account) {
        json(req, res, 401, { error: 'account_not_found' });
        return;
      }
      const state = await store.ensureDomainState(accountId);
      const existing = await store.listGraphProposals(accountId);
      const seenSourceIds = new Set(existing.map((proposal) => proposal.sourceId));
      const confirmedSourceIds = new Set(
        Object.values(state.commitments).map((commitment) => commitment.externalId).filter(Boolean),
      );
      const calendar = new GoogleUserCalendarTool(() => googleAccessToken(store, accountId));
      const events = await calendar.getEvents();
      const now = Date.now();
      const horizonEnd = now + 90 * 24 * 60 * 60_000;
      const candidates = events.filter((event) => {
        const start = Date.parse(event.startIso);
        const sourceId = event.id;
        return Number.isFinite(start) && start >= now && start < horizonEnd
          && !seenSourceIds.has(sourceId)
          && !confirmedSourceIds.has(event.metadata?.googleEventId);
      }).slice(0, 25);
      const builder = new CalendarGraphBuilder();
      let created = 0;
      let excluded = 0;
      let failed = 0;
      const modelCalls: { model?: string; latencyMs: number; totalTokens?: number }[] = [];
      for (const event of candidates) {
        try {
          const result = await builder.propose({
            id: event.id,
            title: event.title,
            startIso: event.startIso,
            endIso: event.endIso,
          });
          modelCalls.push(result.model);
          if (!result.draft.include) {
            excluded += 1;
            await store.saveGraphProposal(accountId, {
              source: result.source,
              draft: result.draft,
              model: result.model,
            }, 'IGNORED');
            continue;
          }
          const saved = await store.saveGraphProposal(accountId, {
            source: result.source,
            draft: result.draft,
            model: result.model,
          });
          if (saved) created += 1;
        } catch (error) {
          failed += 1;
          console.error(JSON.stringify({ severity: 'WARN', msg: 'calendar graph extraction held for review', sourceId: event.id, failure: String(error) }));
        }
      }
      json(req, res, 200, {
        created,
        excluded,
        failed,
        processed: candidates.length,
        model: {
          calls: modelCalls.length,
          models: [...new Set(modelCalls.map((call) => call.model).filter(Boolean))],
          latencyMs: modelCalls.reduce((total, call) => total + call.latencyMs, 0),
          totalTokens: modelCalls.reduce((total, call) => total + (call.totalTokens ?? 0), 0),
        },
        proposals: await store.listGraphProposals(accountId, 'PENDING_REVIEW'),
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/graph/proposals/review') {
      const accountId = getSessionAccountId(req);
      if (!accountId) {
        json(req, res, 401, { error: 'unauthenticated' });
        return;
      }
      const body = safeJson(await readBody(req)) as {
        proposalId?: string; decision?: string; edits?: unknown;
      } | null;
      if (!body?.proposalId || (body.decision !== 'CONFIRMED' && body.decision !== 'REJECTED')) {
        json(req, res, 400, { error: 'invalid_review_request' });
        return;
      }
      let edits: ReturnType<typeof GraphProposalEditsSchema.parse> | undefined;
      if (body.decision === 'CONFIRMED') {
        const parsed = GraphProposalEditsSchema.safeParse(body.edits);
        if (!parsed.success) {
          json(req, res, 400, { error: 'invalid_commitment_edits', issues: parsed.error.issues });
          return;
        }
        edits = parsed.data;
      }
      const result = await (await accountStore()).reviewGraphProposal(
        accountId,
        body.proposalId,
        body.decision,
        edits,
      );
      const store = await accountStore();
      const state = await store.ensureDomainState(accountId);
      await syncMemoryFromStore(store, accountId);
      json(req, res, 200, {
        ...result,
        stateSummary: {
          commitmentCount: Object.keys(state.commitments).length,
          edgeCount: state.edges.length,
        },
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/graph/edges') {
      const accountId = getSessionAccountId(req);
      if (!accountId) {
        json(req, res, 401, { error: 'unauthenticated' });
        return;
      }
      const proposals = await (await accountStore()).listGraphEdgeProposals(accountId, 'PENDING_REVIEW');
      json(req, res, 200, { proposals });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/graph/edges') {
      const accountId = getSessionAccountId(req);
      if (!accountId) {
        json(req, res, 401, { error: 'unauthenticated' });
        return;
      }
      const store = await accountStore();
      const state = await store.ensureDomainState(accountId);
      if (Object.keys(state.commitments).length < 2) {
        json(req, res, 409, { error: 'Add and confirm at least two commitments before suggesting graph links.' });
        return;
      }
      const existing = await store.listGraphEdgeProposals(accountId);
      const existingKeys = new Set([
        ...state.edges.map((edge) => `${edge.type}:${edge.from}:${edge.to}`),
        ...existing.map((edge) => `${edge.type}:${edge.from}:${edge.to}`),
      ]);
      const builder = new GraphEdgeBuilder();
      const result = await builder.propose(state);
      const candidates = result.edges.filter((edge) => !existingKeys.has(`${edge.type}:${edge.from}:${edge.to}`));
      const created = await store.saveGraphEdgeProposals(accountId, candidates, result.model);
      json(req, res, 200, {
        created,
        proposed: candidates.length,
        model: result.model,
        proposals: await store.listGraphEdgeProposals(accountId, 'PENDING_REVIEW'),
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/graph/edges/review') {
      const accountId = getSessionAccountId(req);
      if (!accountId) {
        json(req, res, 401, { error: 'unauthenticated' });
        return;
      }
      const body = safeJson(await readBody(req)) as { proposalId?: string; decision?: string; data?: unknown } | null;
      if (!body?.proposalId || (body.decision !== 'CONFIRMED' && body.decision !== 'REJECTED')) {
        json(req, res, 400, { error: 'invalid_review_request' });
        return;
      }
      let data: ReturnType<typeof GraphEdgeDataEditsSchema.parse> | undefined;
      if (body.decision === 'CONFIRMED' && body.data !== undefined) {
        const parsed = GraphEdgeDataEditsSchema.safeParse(body.data);
        if (!parsed.success) {
          json(req, res, 400, { error: 'invalid_edge_parameters', issues: parsed.error.issues });
          return;
        }
        data = parsed.data;
      }
      const result = await (await accountStore()).reviewGraphEdgeProposal(
        accountId, body.proposalId, body.decision, data,
      );
      const store = await accountStore();
      const state = await store.ensureDomainState(accountId);
      await syncMemoryFromStore(store, accountId);
      json(req, res, 200, { ...result, edgeCount: state.edges.length });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/auth/logout') {
      if (!isAllowedOrigin(req.headers.origin)) {
        json(req, res, 403, { error: 'origin_not_allowed' });
        return;
      }
      res.setHeader('set-cookie', clearSessionCookie());
      json(req, res, 200, { signedOut: true });
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

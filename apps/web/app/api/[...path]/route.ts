import { proxyToOrchestrator } from '../../../lib/orchestrator';

export const dynamic = 'force-dynamic';

/**
 * Forwards the v2 account endpoints that have no dedicated handler. Only these
 * prefixes are proxied; everything else is a 404 at the web edge.
 */
const ALLOWED = [/^demo\/(state|trigger|reset|egress-probe)$/, /^workflows(\/[A-Za-z0-9_:.\-]{1,300}(\/(replan|corrections))?)?$/,
  /^surfaces$/, /^rules(\/candidates\/cand-[0-9a-f-]{36}|\/rule-[a-z0-9-]{4,64})?$/, /^egress$/, /^account$/,
  /^telegram\/link$/, /^hermes\/token$/, /^notes(\/note-[0-9a-f-]{36})?$/, /^source-checks(\/run)?$/, /^account-graph$/];

type Context = { params: Promise<{ path: string[] }> };

async function forward(request: Request, context: Context): Promise<Response> {
  const path = (await context.params).path.map(encodeURIComponent).join('/');
  if (!ALLOWED.some((pattern) => pattern.test(path))) return Response.json({ error: 'not found' }, { status: 404 });
  const query = new URL(request.url).search;
  return proxyToOrchestrator(request, `/api/${path}${query}`);
}

export const GET = forward;
export const POST = forward;
export const DELETE = forward;

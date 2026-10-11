import { proxyToOrchestrator } from '../../../../lib/orchestrator';

export const dynamic = 'force-dynamic';

/** Start an isolated synthetic demo session (no OAuth). */
export async function POST(request: Request): Promise<Response> {
  return proxyToOrchestrator(request, '/auth/demo/start', { method: 'POST', timeoutMs: 30_000 });
}

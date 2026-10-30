import { proxyToOrchestrator } from '../../../../lib/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return proxyToOrchestrator(request, '/api/policy/blocked-events', { timeoutMs: 20_000 });
}

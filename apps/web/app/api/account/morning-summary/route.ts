import { proxyToOrchestrator } from '../../../../lib/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return proxyToOrchestrator(request, '/api/account/morning-summary', { timeoutMs: 15_000 });
}

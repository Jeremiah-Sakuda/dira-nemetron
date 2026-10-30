import { proxyToOrchestrator } from '../../../../../lib/orchestrator';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return proxyToOrchestrator(request, '/api/graph/edges/review', { timeoutMs: 15_000 });
}

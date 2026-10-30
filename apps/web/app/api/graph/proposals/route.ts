import { proxyToOrchestrator } from '../../../../lib/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return proxyToOrchestrator(request, '/api/graph/proposals', { timeoutMs: 120_000 });
}

export async function POST(request: Request): Promise<Response> {
  return proxyToOrchestrator(request, '/api/graph/proposals', { timeoutMs: 120_000 });
}

import { proxyToOrchestrator } from '../../../lib/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return proxyToOrchestrator(request, '/api/availability', { timeoutMs: 20_000 });
}

export async function POST(request: Request): Promise<Response> {
  return proxyToOrchestrator(request, '/api/availability', { timeoutMs: 20_000 });
}

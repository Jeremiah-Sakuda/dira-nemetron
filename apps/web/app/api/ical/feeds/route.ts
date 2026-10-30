import { proxyToOrchestrator } from '../../../../lib/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return proxyToOrchestrator(request, '/api/ical/feeds', { timeoutMs: 30_000 });
}

export async function POST(request: Request): Promise<Response> {
  return proxyToOrchestrator(request, '/api/ical/feeds', { timeoutMs: 30_000 });
}

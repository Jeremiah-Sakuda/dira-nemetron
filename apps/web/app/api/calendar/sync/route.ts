import { proxyToOrchestrator } from '../../../../lib/orchestrator';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return proxyToOrchestrator(request, '/api/calendar/sync', { timeoutMs: 120_000 });
}

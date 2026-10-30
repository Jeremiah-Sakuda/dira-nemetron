import { proxyToOrchestrator } from '../../../../../lib/orchestrator';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ feedId: string }> };

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const { feedId } = await context.params;
  return proxyToOrchestrator(request, `/api/ical/feeds/${encodeURIComponent(feedId)}`, { timeoutMs: 30_000 });
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { feedId } = await context.params;
  return proxyToOrchestrator(request, `/api/ical/feeds/${encodeURIComponent(feedId)}`, { timeoutMs: 30_000 });
}

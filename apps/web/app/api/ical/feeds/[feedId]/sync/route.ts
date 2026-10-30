import { proxyToOrchestrator } from '../../../../../../lib/orchestrator';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Context = { params: Promise<{ feedId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { feedId } = await context.params;
  return proxyToOrchestrator(request, `/api/ical/feeds/${encodeURIComponent(feedId)}/sync`, { timeoutMs: 240_000 });
}

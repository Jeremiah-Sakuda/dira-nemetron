export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const cloudUrl = process.env.DIRA_CLOUD_RUN_URL?.replace(/\/$/, '');
  const configured = Boolean(cloudUrl && process.env.DIRA_DEMO_TOKEN);

  if (!configured || !cloudUrl) {
    return Response.json({
      mode: 'deterministic',
      connected: false,
      detail: 'Local evidence runtime using stateful integration simulators',
    });
  }

  try {
    const status = await fetch(`${cloudUrl}/status`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!status.ok) throw new Error(`Cloud Run returned ${status.status}`);
    const detail = (await status.json()) as { seeded?: boolean; workflowRuns?: number };
    return Response.json({
      mode: 'production',
      connected: true,
      seeded: detail.seeded ?? false,
      workflowRuns: detail.workflowRuns ?? 0,
      detail: 'Cloud Run + Nebius Token Factory + Firestore + Google Calendar',
    });
  } catch (error) {
    return Response.json(
      {
        mode: 'unavailable',
        connected: false,
        detail: 'Production runtime is configured but unreachable',
        error: String(error),
      },
      { status: 503 },
    );
  }
}

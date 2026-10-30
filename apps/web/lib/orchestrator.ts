/**
 * Server-side bridge from the web app to the Dira orchestrator. The session
 * cookie stays on the web origin; it is forwarded server-to-server along with
 * the browser Origin (the orchestrator checks it on every mutation).
 */
export function orchestratorBase(): string | undefined {
  return (process.env.DIRA_ORCHESTRATOR_URL ?? process.env.DIRA_CLOUD_RUN_URL)?.replace(/\/$/, '');
}

export async function proxyToOrchestrator(
  request: Request,
  path: string,
  options: { method?: string; timeoutMs?: number } = {},
): Promise<Response> {
  const base = orchestratorBase();
  const privateHeaders = { 'cache-control': 'private, no-store' };
  if (!base) return Response.json({ error: 'The Dira service is not configured on this deployment.' }, { status: 503, headers: privateHeaders });
  const method = options.method ?? request.method;
  try {
    const body = method === 'GET' || method === 'HEAD' ? undefined : await request.text();
    const upstream = await fetch(`${base}${path}`, {
      method,
      headers: {
        cookie: request.headers.get('cookie') ?? '',
        ...(request.headers.get('origin') ? { origin: request.headers.get('origin')! } : {}),
        ...(request.headers.get('x-forwarded-for') ? { 'x-forwarded-for': request.headers.get('x-forwarded-for')! } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body || undefined,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? (method === 'GET' ? 20_000 : 120_000)),
    });
    // Ordinary account endpoints return JSON. OAuth redirects and binary memory
    // transfers use separate modules; never follow a redirect with account cookies.
    if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) {
      throw new Error('Unexpected account redirect');
    }
    const response = method === 'HEAD' || [204, 205, 304].includes(upstream.status)
      ? new Response(null, { status: upstream.status, headers: privateHeaders })
      : Response.json(await upstream.json(), { status: upstream.status, headers: privateHeaders });
    for (const cookie of upstream.headers.getSetCookie?.() ?? []) response.headers.append('set-cookie', cookie);
    return response;
  } catch {
    return Response.json({ error: 'The Dira service is unavailable. Try again in a moment.' }, { status: 503, headers: privateHeaders });
  }
}

export const dynamic = 'force-dynamic';

/** The Evidence replay always runs the deterministic engine locally. */
export async function GET(): Promise<Response> {
  return Response.json({
    mode: 'deterministic',
    connected: false,
    detail: 'Deterministic engine evidence: stored interpretations and stateful integration simulators',
  });
}

'use client';

export interface FlightLine {
  seq: number;
  atIso: string;
  phase: string;
  message: string;
  data?: unknown;
}

const PHASE_TONE: Record<string, string> = {
  EVENT: 'neutral', INTERPRET: 'accent', GRAPH: 'neutral', PROPAGATE: 'neutral', FEASIBILITY: 'warning',
  PLAN: 'neutral', PROPOSE: 'accent', REJECT: 'critical', SELECT: 'accent', POLICY: 'neutral', LEDGER: 'neutral',
  APPROVAL: 'warning', ACTION: 'accent', ERROR: 'critical', OBSERVE: 'warning', REPLAN: 'warning',
  VERIFY: 'good', RESOLVED: 'good', WAITING_REVIEW: 'serious',
};

/** The flight record: every structured decision a run made, in order. No hidden reasoning. */
export function FlightTimeline({ lines, compact = false }: { lines: FlightLine[]; compact?: boolean }) {
  if (!lines.length) return <p className="muted">No flight record yet.</p>;
  return (
    <ol className={`flight-timeline${compact ? ' compact' : ''}`} aria-label="Flight record">
      {lines.map((line) => {
        const model = modelCall(line.data);
        return (
          <li key={`${line.seq}-${line.phase}`} className="flight-line" data-tone={PHASE_TONE[line.phase] ?? 'neutral'}>
            <span className="flight-line-phase">{line.phase.replace('_', ' ')}</span>
            <span className="flight-line-message">
              {line.message}
              {model && <span className="flight-line-model">{model}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function modelCall(data: unknown): string | undefined {
  const call = (data as { modelCall?: { model?: string; tier?: string; latencyMs?: number; totalTokens?: number; provider?: string } } | undefined)?.modelCall;
  if (!call?.model) return undefined;
  const parts = [call.tier ? `Nemotron ${call.tier}` : call.model, call.provider, call.latencyMs ? `${(call.latencyMs / 1000).toFixed(1)}s` : undefined,
    call.totalTokens ? `${call.totalTokens} tokens` : undefined].filter(Boolean);
  return parts.join(' · ');
}

/**
 * Flight recorder (PRD §35 + §48): the inspectable, structured record of
 * everything a workflow did — events, interpretations, propagation, plans,
 * policy verdicts, actions, failures, verification, resolution. No hidden
 * chain-of-thought: only structured decisions are recorded.
 */

export type FlightPhase =
  | 'EVENT'
  | 'INTERPRET'
  | 'GRAPH'
  | 'PROPAGATE'
  | 'FEASIBILITY'
  | 'PLAN'
  | 'PROPOSE'
  | 'REJECT'
  | 'SELECT'
  | 'POLICY'
  | 'LEDGER'
  | 'ACTION'
  | 'ERROR'
  | 'OBSERVE'
  | 'REPLAN'
  | 'VERIFY'
  | 'RESOLVED'
  | 'APPROVAL'
  | 'WAITING_REVIEW';

export interface FlightEntry {
  seq: number;
  atIso: string;
  phase: FlightPhase;
  message: string;
  data?: unknown;
}

export type FlightListener = (entry: FlightEntry) => void;

export class FlightRecorder {
  private entries: FlightEntry[] = [];
  private listeners: FlightListener[] = [];
  private seq = 0;

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  record(phase: FlightPhase, message: string, data?: unknown): FlightEntry {
    const entry: FlightEntry = {
      seq: ++this.seq,
      atIso: this.now(),
      phase,
      message,
      data,
    };
    this.entries.push(entry);
    for (const l of this.listeners) l(entry);
    return entry;
  }

  onEntry(listener: FlightListener): void {
    this.listeners.push(listener);
  }

  all(): FlightEntry[] {
    return [...this.entries];
  }

  byPhase(phase: FlightPhase): FlightEntry[] {
    return this.entries.filter((e) => e.phase === phase);
  }
}

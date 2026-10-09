import { ActionLedger, InMemoryLedgerStore, type LedgerStore } from '@dira/action-ledger';
import { FixtureCalendarTool } from '@dira/adapter-calendar';
import { FixtureGmailTool } from '@dira/adapter-gmail';
import { FixtureOrgTaskTool } from '@dira/adapter-organization';
import { FixtureRecruiterTool, type SlotState } from '@dira/adapter-recruiter';
import type { DomainState } from '@dira/commitment-model';
import type { InterpretationResult, RawEmailEvent } from '@dira/event-schema';
import { FlightRecorder } from '@dira/observability';
import type { CalendarEvent, GmailMessage, OrgTask, ToolSet } from '@dira/tool-contracts';
import {
  FixtureModelClient,
  NemotronModelClient,
  type ModelClient,
} from './interpreter.js';
import {
  DiraOrchestrator,
  InMemoryWorkflowStore,
  makeReplayClock,
  type WorkflowStore,
} from './orchestrator.js';

/**
 * Credential-free replay runtime (PRD §38–§39).
 *
 * REPLAY_MODE=deterministic — stored interpretation fixtures, local adapters.
 * REPLAY_MODE=live-model    — Nemotron interprets through Token Factory; tools stay local.
 * REPLAY_MODE=production    — real Google services (Cloud Run deployment).
 */

export type ReplayMode = 'deterministic' | 'live-model';

/** Structural shape of a workflow fixture (satisfied by @dira/fixtures). */
export interface ReplayFixture {
  state: DomainState;
  calendarSeed: CalendarEvent[];
  orgSeed: OrgTask[];
  recruiterSlots: { interviewId: string; slots: SlotState[] };
  inboxSeed: GmailMessage[];
  trigger: RawEmailEvent;
  interpretation: InterpretationResult;
}

export interface ReplayRuntime {
  orchestrator: DiraOrchestrator;
  recorder: FlightRecorder;
  ledger: ActionLedger;
  tools: ToolSet & {
    calendar: FixtureCalendarTool;
    gmail: FixtureGmailTool;
    org: FixtureOrgTaskTool;
    recruiter: FixtureRecruiterTool;
  };
}

export interface ReplayRuntimeOptions {
  mode?: ReplayMode;
  ledgerStore?: LedgerStore;
  workflowStore?: WorkflowStore;
  /** Extra stored interpretations (eval corpus, secondary trigger, ...). */
  extraInterpretations?: Record<string, InterpretationResult>;
  model?: ModelClient;
  /**
   * Reuse an existing "external world" (adapter set) — used by crash-resume
   * tests where a fresh worker must see the state a dead worker left behind.
   */
  tools?: ReplayRuntime['tools'];
}

export async function buildReplayRuntime(
  fixture: ReplayFixture,
  opts: ReplayRuntimeOptions = {},
): Promise<ReplayRuntime> {
  const mode = opts.mode ?? 'deterministic';

  let tools = opts.tools;
  if (!tools) {
    const calendar = new FixtureCalendarTool(fixture.calendarSeed);
    const gmail = new FixtureGmailTool(fixture.inboxSeed);
    const org = new FixtureOrgTaskTool(fixture.orgSeed);
    const recruiter = new FixtureRecruiterTool();
    recruiter.setSlots(fixture.recruiterSlots.interviewId, fixture.recruiterSlots.slots);
    tools = { calendar, gmail, org, recruiter };
  }

  const model: ModelClient =
    opts.model ??
    (mode === 'live-model'
      ? new NemotronModelClient()
      : new FixtureModelClient({
          [fixture.trigger.messageId]: fixture.interpretation,
          ...opts.extraInterpretations,
        }));

  // One deterministic logical clock shared by recorder and ledger, so every
  // replay produces an identical, reproducible timeline.
  const clock = makeReplayClock(fixture.trigger.receivedAtIso);
  const recorder = new FlightRecorder(clock);
  const ledger = await ActionLedger.open(opts.ledgerStore ?? new InMemoryLedgerStore(), clock);
  const orchestrator = new DiraOrchestrator(
    structuredClone(fixture.state),
    tools,
    ledger,
    recorder,
    model,
    opts.workflowStore ?? new InMemoryWorkflowStore(),
    { sleep: () => Promise.resolve() },
  );

  return { orchestrator, recorder, ledger, tools };
}

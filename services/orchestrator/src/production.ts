import type { Firestore } from '@google-cloud/firestore';
import { FirestoreActionLedger } from '@dira/action-ledger/firestore-ledger';
import {
  DiraOrchestrator,
  NemotronModelClient,
  computeRunMetrics,
  summarizeSurfaceChanges,
  type RunMetrics,
  type SurfaceChange,
  type WorkflowRun,
  type ModelClient,
} from '@dira/agent';
import {
  FirestoreWorkflowStore,
  clearCollections,
  getFirestoreDb,
  loadDomainState,
  saveDomainState,
  saveFlight,
} from '@dira/agent/firestore-stores';
import { GoogleCalendarTool, ensureDemoCalendar } from '@dira/adapter-calendar/google';
import { FirestoreOutboxGmailTool } from '@dira/adapter-gmail/firestore';
import { FirestoreOrgTaskTool } from '@dira/adapter-organization/firestore';
import { FirestoreRecruiterTool } from '@dira/adapter-recruiter/firestore';
import { FlightRecorder, type FlightEntry } from '@dira/observability';
import type { RawEmailEvent } from '@dira/event-schema';
import type { ToolSet } from '@dira/tool-contracts';
import { buildGoldenFixture, type GoldenVariation } from '@dira/fixtures/golden';

/**
 * PRODUCTION MODE (PRD §39): the same engine, wired to durable, real
 * backends —
 *   interpretation : Nemotron through Nebius Token Factory
 *   calendar       : REAL Google Calendar (service-account-owned demo
 *                    calendar shared to the demo user)
 *   ledger/state   : Firestore (transactional outbox, per-doc records)
 *   recruiter/org  : Firestore-backed CONTROLLED test integrations (§46),
 *                    durable and console-mutable for the live demo
 *   notifications  : Firestore outbound_messages (consumer Gmail cannot be
 *                    sent from a service account — DEVIATIONS #13)
 */

const DEMO_CALENDAR_SUMMARY = 'Dira Demo — Sam Adeyemi';

export interface ProductionRunResult {
  run: WorkflowRun;
  metrics: RunMetrics;
  flight: FlightEntry[];
  modelCall?: ModelClient['lastCall'];
  calendarId: string;
  changes: SurfaceChange[];
}

export class EventAlreadyProcessingError extends Error {
  override name = 'EventAlreadyProcessingError';
}

async function getCalendarId(db: Firestore): Promise<string> {
  const snap = await db.collection('dira_meta').doc('calendar').get();
  const id = snap.exists ? (snap.data() as { calendarId?: string }).calendarId : undefined;
  if (!id) throw new Error('demo calendar not provisioned — POST /demo/reset first');
  return id;
}

async function buildTools(db: Firestore, calendarId: string): Promise<ToolSet> {
  return {
    calendar: await GoogleCalendarTool.create(calendarId),
    gmail: new FirestoreOutboxGmailTool(db),
    org: new FirestoreOrgTaskTool(db),
    recruiter: new FirestoreRecruiterTool(db),
  };
}

/** Seed (or reseed) the entire demo world. Idempotent; safe to re-run. */
export async function seedProduction(
  variation: GoldenVariation = {},
): Promise<{ calendarId: string; seededEvents: number }> {
  const db = await getFirestoreDb();
  const fixture = buildGoldenFixture(variation);

  const { calendarId } = await ensureDemoCalendar(
    DEMO_CALENDAR_SUMMARY,
    process.env.DIRA_SHARE_CALENDAR_WITH,
  );
  await db.collection('dira_meta').doc('calendar').set({ calendarId });

  // Fresh workflow surfaces; durable world reseeded from the fixture.
  await clearCollections(db, [
    'action_ledger', 'workflow_runs', 'workflow_steps', 'outbound_messages',
    'commitments', 'commitment_edges', 'events',
    'recruiter_confirmed', 'recruiter_bookings', 'gmail_inbox', 'org_tasks',
  ]);
  await saveDomainState(db, fixture.state);

  const tools = await buildTools(db, calendarId);
  const recruiter = tools.recruiter as FirestoreRecruiterTool;
  await recruiter.clear(fixture.recruiterSlots.interviewId);
  await recruiter.seedSlots(fixture.recruiterSlots.interviewId, fixture.recruiterSlots.slots);
  await (tools.org as FirestoreOrgTaskTool).seed(fixture.orgSeed);
  await (tools.gmail as FirestoreOutboxGmailTool).seedInbox(fixture.inboxSeed);

  // Real Google Calendar: remove every Dira-managed event, then recreate the
  // initial week exactly as the fixture describes it.
  const existing = await tools.calendar.getEvents();
  for (const e of existing) await tools.calendar.deleteEvent(e.id);
  for (const e of fixture.calendarSeed) await tools.calendar.createEvent(e);

  return { calendarId, seededEvents: fixture.calendarSeed.length };
}

/** Handle one normalized event end-to-end against the production world. */
export async function handleProductionEvent(
  trigger: RawEmailEvent,
  onEntry?: (entry: FlightEntry) => void,
): Promise<ProductionRunResult> {
  const db = await getFirestoreDb();
  const calendarId = await getCalendarId(db);
  const state = await loadDomainState(db);
  if (!state) throw new Error('no seeded state — POST /demo/reset first');

  // Firestore event claim (PRD §28). Completed deliveries return their prior
  // result, concurrent deliveries stop, and an expired lease allows a fresh
  // worker to resume after a hard process death.
  const eventRef = db.collection('events').doc(trigger.eventId);
  const claimedAtIso = new Date().toISOString();
  const leaseUntilIso = new Date(Date.now() + 5 * 60_000).toISOString();
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(eventRef);
    const previous = snap.exists
      ? (snap.data() as { status?: string; leaseUntilIso?: string; firstSeenIso?: string; attempts?: number })
      : undefined;
    const leaseExpired = previous?.leaseUntilIso
      ? Date.parse(previous.leaseUntilIso) < Date.now()
      : false;
    if (!previous || previous.status === 'FAILED' || leaseExpired) {
      tx.set(eventRef, {
        ...trigger,
        status: 'PROCESSING',
        firstSeenIso: previous?.firstSeenIso ?? claimedAtIso,
        claimedAtIso,
        leaseUntilIso,
        attempts: (previous?.attempts ?? 0) + 1,
      });
      return 'CLAIMED' as const;
    }
    return previous.status === 'COMPLETED' ? 'COMPLETED' as const : 'PROCESSING' as const;
  });

  const workflowStore = new FirestoreWorkflowStore(db);
  if (claim !== 'CLAIMED') {
    const existing = await workflowStore.get(`wf-${trigger.eventId}`);
    if (claim === 'COMPLETED' && existing && existing.status !== 'RUNNING') {
      const { loadFlight } = await import('@dira/agent/firestore-stores');
      const ledger = await FirestoreActionLedger.open(db);
      return {
        run: existing,
        metrics: computeRunMetrics(existing, ledger),
        flight: await loadFlight(db, existing.id),
        calendarId,
        changes: [],
      };
    }
    throw new EventAlreadyProcessingError(`event ${trigger.eventId} is already processing`);
  }

  try {
    const tools = await buildTools(db, calendarId);
    const model = new NemotronModelClient();
    const recorder = new FlightRecorder();
    if (onEntry) recorder.onEntry(onEntry);
    const ledger = await FirestoreActionLedger.open(db);

    // Snapshot the world before the run so we can diff the external surfaces
    // the orchestrator mutates it in place during interpretation.
    const beforeState = structuredClone(state);
    const orchestrator = new DiraOrchestrator(
      state, tools, ledger, recorder, model, workflowStore,
    );
    const run = await orchestrator.handleEvent(trigger);
    const changes = summarizeSurfaceChanges(beforeState, orchestrator.state);

    // Persist artifacts: flight recording + the updated commitment graph.
    await saveFlight(db, run.id, recorder.all());
    await saveDomainState(db, orchestrator.state);
    // Lifetime counter in dira_meta (never cleared by reseeds), so /status
    // reflects real usage instead of the perpetually-reset workflow count.
    const { FieldValue } = await import('@google-cloud/firestore');
    await db.collection('dira_meta').doc('stats').set(
      {
        totalRuns: FieldValue.increment(1),
        lastRunAtIso: new Date().toISOString(),
        lastRunStatus: run.status,
      },
      { merge: true },
    );
    await eventRef.set({
      status: 'COMPLETED',
      workflowId: run.id,
      completedAtIso: new Date().toISOString(),
      leaseUntilIso: null,
    }, { merge: true });

    return {
      run,
      metrics: computeRunMetrics(run, ledger),
      flight: recorder.all(),
      modelCall: model.lastCall,
      calendarId,
      changes,
    };
  } catch (error) {
    await eventRef.set({
      status: 'FAILED',
      failedAtIso: new Date().toISOString(),
      leaseUntilIso: null,
      failure: String(error),
    }, { merge: true });
    throw error;
  }
}

export async function latestProductionRun(): Promise<{
  run: WorkflowRun;
  flight: FlightEntry[];
} | null> {
  const db = await getFirestoreDb();
  const snap = await db.collection('workflow_runs').orderBy('updatedAtIso', 'desc').limit(1).get();
  const latest = snap.docs[0]?.data() as WorkflowRun | undefined;
  if (!latest) return null;
  const { loadFlight } = await import('@dira/agent/firestore-stores');
  return { run: latest, flight: await loadFlight(db, latest.id) };
}

export async function productionStatus(): Promise<{
  seeded: boolean;
  commitments?: number;
  workflowRuns?: number;
  totalRuns?: number;
}> {
  const db = await getFirestoreDb();
  const cal = await db.collection('dira_meta').doc('calendar').get();
  if (!cal.exists) return { seeded: false };
  const [commitments, runs, stats] = await Promise.all([
    db.collection('commitments').count().get(),
    db.collection('workflow_runs').count().get(),
    db.collection('dira_meta').doc('stats').get(),
  ]);
  return {
    seeded: true,
    commitments: commitments.data().count,
    // workflow_runs is cleared on every reseed; totalRuns survives resets.
    workflowRuns: runs.data().count,
    totalRuns: stats.exists ? ((stats.data() as { totalRuns?: number }).totalRuns ?? 0) : 0,
  };
}

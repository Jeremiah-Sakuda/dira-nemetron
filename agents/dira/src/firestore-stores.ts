import type { Firestore } from '@google-cloud/firestore';
import type { Commitment, CommitmentEdge, DomainState } from '@dira/commitment-model';
import type { FlightEntry } from '@dira/observability';
import type { WorkflowRun, WorkflowStore } from './orchestrator.js';

/**
 * Firestore persistence for production mode (PRD §32–§33):
 *  - `workflow_runs/`      one document per repair workflow
 *  - `workflow_steps/`     flight-recorder entries per run
 *  - `commitments/`        graph nodes
 *  - `commitment_edges/`   typed edges
 *  - `dira_meta/`          config, availability, people, calendar binding
 *
 * The engine stays storage-agnostic; these helpers are the adapter.
 */

let dbSingleton: Firestore | undefined;
export async function getFirestoreDb(): Promise<Firestore> {
  if (!dbSingleton) {
    const { Firestore } = await import('@google-cloud/firestore');
    dbSingleton = new Firestore({ ignoreUndefinedProperties: true });
  }
  return dbSingleton;
}

const strip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class FirestoreWorkflowStore implements WorkflowStore {
  constructor(private readonly db: Firestore) {}

  async get(id: string): Promise<WorkflowRun | undefined> {
    const snap = await this.db.collection('workflow_runs').doc(id).get();
    return snap.exists ? decodeRun(snap.data() as Record<string, unknown>) : undefined;
  }

  async save(run: WorkflowRun): Promise<void> {
    await this.db.collection('workflow_runs').doc(run.id).set(strip({
      ...run,
      // Firestore forbids arrays nested directly in arrays; store the
      // planning rounds as an index-keyed map instead.
      planningRounds: Object.fromEntries(
        run.planningRounds.map((round, i) => [`round${i}`, round]),
      ),
      updatedAtIso: new Date().toISOString(),
    }));
  }
}

function decodeRun(data: Record<string, unknown>): WorkflowRun {
  const rounds = data.planningRounds;
  if (rounds && !Array.isArray(rounds)) {
    data = {
      ...data,
      planningRounds: Object.entries(rounds as Record<string, unknown>)
        .sort(([a], [b]) => Number(a.replace('round', '')) - Number(b.replace('round', '')))
        .map(([, v]) => v),
    };
  }
  return data as unknown as WorkflowRun;
}

export async function saveDomainState(db: Firestore, state: DomainState): Promise<void> {
  const batchLimit = 400;
  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (ops > 0) await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (const c of Object.values(state.commitments)) {
    batch.set(db.collection('commitments').doc(c.id), strip(c));
    if (++ops >= batchLimit) await flush();
  }
  for (const e of state.edges) {
    batch.set(db.collection('commitment_edges').doc(e.id), strip(e));
    if (++ops >= batchLimit) await flush();
  }
  batch.set(db.collection('dira_meta').doc('config'), strip({
    userId: state.userId,
    timezone: state.timezone,
    horizonStartIso: state.horizonStartIso,
    horizonEndMin: state.horizonEndMin,
    availability: state.availability,
    approvedSlots: state.approvedSlots,
    people: state.people,
    constraints: state.constraints,
    config: state.config,
  }));
  ops++;
  await flush();
}

export async function loadDomainState(db: Firestore): Promise<DomainState | null> {
  const meta = await db.collection('dira_meta').doc('config').get();
  if (!meta.exists) return null;
  const [commitments, edges] = await Promise.all([
    db.collection('commitments').get(),
    db.collection('commitment_edges').get(),
  ]);
  const m = meta.data() as Omit<DomainState, 'commitments' | 'edges'>;
  return {
    ...m,
    commitments: Object.fromEntries(
      commitments.docs.map((d) => [d.id, d.data() as Commitment]),
    ),
    edges: edges.docs.map((d) => d.data() as CommitmentEdge),
  };
}

export async function saveFlight(db: Firestore, runId: string, entries: FlightEntry[]): Promise<void> {
  await db.collection('workflow_steps').doc(runId).set({ runId, entries: strip(entries) });
}

export async function loadFlight(db: Firestore, runId: string): Promise<FlightEntry[]> {
  const snap = await db.collection('workflow_steps').doc(runId).get();
  return snap.exists ? ((snap.data() as { entries: FlightEntry[] }).entries ?? []) : [];
}

/** Delete every doc in the named collections (demo reseed). */
export async function clearCollections(db: Firestore, names: string[]): Promise<void> {
  for (const name of names) {
    const snap = await db.collection(name).get();
    while (snap.docs.length > 0) {
      const chunk = snap.docs.splice(0, 400);
      const batch = db.batch();
      for (const doc of chunk) batch.delete(doc.ref);
      await batch.commit();
    }
  }
}

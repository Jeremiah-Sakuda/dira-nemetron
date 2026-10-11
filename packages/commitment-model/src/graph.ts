import type { CommitmentEdge, DomainState, EdgeType } from './types.js';

/** Outgoing edges of a node, optionally filtered by type. */
export function edgesFrom(state: DomainState, id: string, type?: EdgeType): CommitmentEdge[] {
  return state.edges.filter((e) => e.from === id && (!type || e.type === type));
}

/** Incoming edges of a node, optionally filtered by type. */
export function edgesTo(state: DomainState, id: string, type?: EdgeType): CommitmentEdge[] {
  return state.edges.filter((e) => e.to === id && (!type || e.type === type));
}

/** All edges touching a node. */
export function edgesTouching(state: DomainState, id: string): CommitmentEdge[] {
  return state.edges.filter((e) => e.from === id || e.to === id);
}

/** Allowed alternative owners reachable through DELEGATABLE_TO edges. */
export function delegationTargets(state: DomainState, commitmentId: string): string[] {
  return edgesFrom(state, commitmentId, 'DELEGATABLE_TO').map((e) => e.to);
}

/**
 * Detect cycles among ordering edges (DEPENDS_ON / BLOCKED_BY / MUST_PRECEDE /
 * MUST_FOLLOW). Propagation is cycle-safe regardless, but an ordering cycle in
 * the stored graph is a data error worth surfacing.
 */
export function findOrderingCycle(state: DomainState): string[] | null {
  const orderTypes: EdgeType[] = ['DEPENDS_ON', 'BLOCKED_BY', 'MUST_PRECEDE', 'MUST_FOLLOW'];
  const adj = new Map<string, string[]>();
  for (const e of state.edges) {
    if (!orderTypes.includes(e.type)) continue;
    // Normalize direction: an edge X→Y meaning "X must happen before Y".
    const [a, b] =
      e.type === 'MUST_PRECEDE' ? [e.from, e.to]
      : e.type === 'MUST_FOLLOW' ? [e.to, e.from]
      : /* DEPENDS_ON / BLOCKED_BY: prerequisite is the target */ [e.to, e.from];
    adj.set(a, [...(adj.get(a) ?? []), b]);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  let cycle: string[] | null = null;
  const visit = (n: string): boolean => {
    color.set(n, GRAY);
    stack.push(n);
    for (const m of adj.get(n) ?? []) {
      const c = color.get(m) ?? WHITE;
      if (c === GRAY) {
        cycle = [...stack.slice(stack.indexOf(m)), m];
        return true;
      }
      if (c === WHITE && visit(m)) return true;
    }
    stack.pop();
    color.set(n, BLACK);
    return false;
  };
  for (const n of adj.keys()) {
    if ((color.get(n) ?? WHITE) === WHITE && visit(n)) return cycle;
  }
  return null;
}

/**
 * People Dira may contact about a commitment: its participants, owner, the
 * person a user-confirmed OWNED_BY edge names, and stored DELEGATABLE_TO
 * backups. The user themself is excluded. Recipients outside this set are
 * denied by policy no matter what a model or message proposes.
 */
export function commitmentStakeholders(state: DomainState, commitmentId: string): string[] {
  const commitment = state.commitments[commitmentId];
  if (!commitment) return [];
  const ids = new Set<string>(commitment.participants);
  if (commitment.owner) ids.add(commitment.owner);
  for (const edge of edgesFrom(state, commitmentId, 'OWNED_BY')) ids.add(edge.to);
  for (const id of delegationTargets(state, commitmentId)) ids.add(id);
  ids.delete(state.userId);
  return [...ids].filter((id) => Boolean(state.people[id]?.email));
}

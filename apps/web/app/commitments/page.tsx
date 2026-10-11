import { StatusPill } from '../../components/status';
import { fmtTime, getGoldenRunData } from '../../lib/replay-data';

export const metadata = { title: 'Reference commitments — Dira evidence' };

export const dynamic = 'force-dynamic';

const FLEX_LABEL: Record<string, string> = {
  FIXED: 'fixed',
  MOVE_WITHIN_WINDOW: 'move within window',
  FLEXIBLE: 'flexible',
  DELEGATABLE: 'delegatable',
  OPTIONAL: 'optional',
};

export default async function CommitmentsPage() {
  const { commitmentsBefore, commitmentsAfter, run } = await getGoldenRunData();
  const after = new Map(commitmentsAfter.map((c) => [c.id, c]));

  const rows = commitmentsBefore
    .filter((c) => !c.reservesEffortFor)
    .sort((a, b) => (a.startMin ?? a.deadlineMin ?? 0) - (b.startMin ?? b.deadlineMin ?? 0));

  return (
    <main>
      <h1 className="page-title">Commitments</h1>
      <p className="page-sub">
        Not tasks — commitments: outcomes with time requirements, dependencies,
        stakeholders, flexibility, and policies governing how Dira may alter them.
        The “after” column shows where the deterministic 48-Hour Shock reference repair left each one.
      </p>

      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="data">
          <thead>
            <tr>
              <th>Commitment</th>
              <th>Domain</th>
              <th>Flexibility</th>
              <th>Criticality</th>
              <th>Before</th>
              <th>After repair</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const now = after.get(c.id);
              const changed =
                now &&
                (now.startMin !== c.startMin || now.owner !== c.owner || now.status !== c.status);
              return (
                <tr key={c.id}>
                  <td>
                    {c.title}
                    {run.affected.includes(c.id) && (
                      <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                        affected
                      </span>
                    )}
                  </td>
                  <td>{c.domain}</td>
                  <td>{FLEX_LABEL[c.flexibility]}</td>
                  <td>
                    <StatusPill
                      kind={c.criticality === 'CRITICAL' ? 'critical' : c.criticality === 'HIGH' ? 'serious' : 'neutral'}
                      label={c.criticality.toLowerCase()}
                    />
                  </td>
                  <td className="mono">
                    {c.kind === 'effort' && !c.startMin
                      ? `${((c.requiredEffortMin ?? 0) - (c.completedEffortMin ?? 0)) / 60}h by ${fmtTime(c.deadlineMin)}`
                      : fmtTime(c.startMin)}
                    {c.kind === 'effort' && c.startMin ? ` (owner: ${c.owner.replace('user-', '')})` : ''}
                  </td>
                  <td className="mono" style={changed ? { color: 'var(--accent)' } : undefined}>
                    {now
                      ? now.kind === 'effort' && !now.startMin
                        ? `${((now.requiredEffortMin ?? 0) - (now.completedEffortMin ?? 0)) / 60}h by ${fmtTime(now.deadlineMin)}`
                        : `${fmtTime(now.startMin)}${now.owner !== c.owner ? ` → ${now.owner}` : ''}`
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

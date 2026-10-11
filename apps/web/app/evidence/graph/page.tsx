import { getGoldenRunData } from '../../../lib/replay-data';

export const metadata = { title: 'Reference graph — Dira evidence' };

export const dynamic = 'force-dynamic';

/**
 * The typed commitment graph, laid out by domain column. Edges are the
 * mechanism: propagation walks them, planners cite them, policy checks them.
 */
export default async function GraphPage() {
  const { commitmentsBefore, edges, run } = await getGoldenRunData();
  const nodes = commitmentsBefore.filter((c) => !c.reservesEffortFor);

  const columns: Record<string, string[]> = { academic: [], career: [], organization: [], personal: [] };
  for (const c of nodes) columns[c.domain]?.push(c.id);

  const colX: Record<string, number> = { academic: 120, career: 400, organization: 680, personal: 960 };
  const pos = new Map<string, { x: number; y: number }>();
  for (const [domain, ids] of Object.entries(columns)) {
    ids.forEach((id, i) => pos.set(id, { x: colX[domain]!, y: 90 + i * 92 }));
  }
  const maxY = Math.max(...[...pos.values()].map((p) => p.y)) + 70;
  const title = (id: string) => nodes.find((n) => n.id === id)?.title ?? id;

  const drawable = edges.filter((e) => pos.has(e.from) && pos.has(e.to));
  const externalEdges = edges.filter((e) => pos.has(e.from) && !pos.has(e.to));

  return (
    <main>
      <h1 className="page-title">Reference graph (48-Hour Shock fixture)</h1>
      <p className="page-sub">
        Typed edges are stored data, not prose: REQUIRES_PREPARATION carries the prep
        deadline, REQUIRES_BUFFER carries the 3h post-exam recovery constraint,
        DELEGATABLE_TO bounds who the planner may propose. Highlighted nodes were
        reached by propagation during the 48-Hour Shock.
      </p>
      <div className="panel" style={{ overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 1080 ${maxY}`}
          style={{ minWidth: 900, width: '100%', height: 'auto' }}
          role="img"
          aria-label="Typed commitment graph across academic, career, organization and personal domains"
        >
          <defs>
            <marker id="edge-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--text-muted)" />
            </marker>
          </defs>
          {Object.entries(colX).map(([domain, x]) => (
            <text key={domain} x={x} y={40} textAnchor="middle" fontSize="11" letterSpacing="2"
              fill="var(--text-muted)" fontFamily="var(--mono)">
              {domain.toUpperCase()}
            </text>
          ))}
          {drawable.map((e, index) => {
            const a = pos.get(e.from)!;
            const b = pos.get(e.to)!;
            const sameColumn = a.x === b.x;
            const controlX = sameColumn
              ? a.x + (index % 2 === 0 ? 74 : -74)
              : (a.x + b.x) / 2;
            const midX = sameColumn ? controlX : (a.x + b.x) / 2;
            const midY = (a.y + b.y) / 2 - 10;
            const path = `M ${a.x} ${a.y} C ${controlX} ${a.y}, ${controlX} ${b.y}, ${b.x} ${b.y}`;
            return (
              <g key={e.id}>
                <path d={path} fill="none" stroke="var(--text-muted)" strokeOpacity="0.65" strokeWidth="1.3" markerEnd="url(#edge-arrow)" />
                <circle cx={midX} cy={midY - 3} r={9} fill="var(--surface-0)" stroke="var(--text-muted)" />
                <text x={midX} y={midY} textAnchor="middle" fontSize="8.5" fill="var(--text-secondary)" fontFamily="var(--mono)">
                  {index + 1}
                </text>
              </g>
            );
          })}
          {nodes.map((n) => {
            const p = pos.get(n.id)!;
            const hit = run.affected.includes(n.id) || n.id === 'econ402-midterm-2';
            return (
              <g key={n.id}>
                <rect
                  x={p.x - 105}
                  y={p.y - 24}
                  width={210}
                  height={48}
                  rx={9}
                  fill={hit ? 'var(--surface-2)' : 'var(--surface-1)'}
                  stroke={hit ? 'var(--accent)' : 'var(--border)'}
                  strokeWidth={hit ? 1.6 : 1}
                />
                <text x={p.x} y={p.y - 2} textAnchor="middle" fontSize="12" fill="var(--text-primary)">
                  {title(n.id).length > 30 ? `${title(n.id).slice(0, 29)}…` : title(n.id)}
                </text>
                <text x={p.x} y={p.y + 15} textAnchor="middle" fontSize="9.5" fill="var(--text-muted)" fontFamily="var(--mono)">
                  {n.flexibility}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="edge-legend" aria-label="Graph edge legend">
          {drawable.map((edge, index) => (
            <div className="edge-legend-row" key={edge.id}>
              <span className="edge-number">{index + 1}</span>
              <span>
                <strong>{edge.type}</strong>
                <span className="muted"> {title(edge.from)} → {title(edge.to)}</span>
              </span>
            </div>
          ))}
        </div>
        {externalEdges.length > 0 && (
          <p className="footnote" style={{ marginTop: 16 }}>
            External-target edges not plotted as commitment nodes:{' '}
            {externalEdges.map((edge) => `${edge.type} (${title(edge.from)} → ${edge.to})`).join(' · ')}.
          </p>
        )}
      </div>
    </main>
  );
}

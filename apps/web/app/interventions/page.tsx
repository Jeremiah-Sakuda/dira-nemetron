import { LiveReplay } from '../../components/live-replay';
import { PHASE_TONE, StatusPill, Tile } from '../../components/status';
import { fmtSlack, getGoldenRunData } from '../../lib/replay-data';

export const metadata = { title: 'Replay — Dira evidence' };

export const dynamic = 'force-dynamic';

export default async function InterventionsPage() {
  const { run, metrics, entries } = await getGoldenRunData();

  return (
    <main>
      <h1 className="page-title">Repair a broken week</h1>
      <p className="page-sub">
        Choose a real scheduling shock, then let Dira find the commitments it affects,
        make only authorized repairs, and verify the result. The flight recorder below
        makes every decision and side effect inspectable.
      </p>

      <div className="stack">
        <LiveReplay />

        <details className="panel reference-run">
          <summary>Reference run evidence — ECON 402, the 48-Hour Shock</summary>
          <div className="reference-run-content">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
            <div className="section-label" style={{ margin: 0 }}>
              Deterministic baseline flight recorder
            </div>
            <StatusPill
              kind={run.status === 'RESOLVED' ? 'good' : run.status === 'RUNNING' ? 'accent' : 'warning'}
              label={run.status}
            />
          </div>

          <div className="tile-row">
            <Tile k="Slack before" v={fmtSlack(run.slackBeforeMin ?? 0)} />
            <Tile
              k="After mutation"
              v={fmtSlack(run.slackAfterMutationMin ?? 0)}
              tone={(run.slackAfterMutationMin ?? 0) < 0 ? 'critical' : 'good'}
            />
            <Tile
              k="After repair"
              v={fmtSlack(run.slackFinalMin ?? 0)}
              tone={(run.slackFinalMin ?? 0) > 0 ? 'good' : 'critical'}
            />
            <Tile k="Replans" v={String(run.replans)} />
          </div>

          <div className="flight">
            {entries.map((e) => (
              <div className="flight-row" key={e.seq}>
                <span className="flight-time">{e.atIso.slice(11, 19)}</span>
                <span className="flight-phase" style={{ color: PHASE_TONE[e.phase] ?? 'var(--text-primary)' }}>
                  {e.phase}
                </span>
                <span className="flight-msg">{e.message}</span>
              </div>
            ))}
          </div>
          </div>
        </details>

        <div className="panel" style={{ overflowX: 'auto' }}>
          <div className="section-label">
            Candidate plans — deterministic reference, round 1
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            From the reproducible baseline run of the default scenario; a live
            run above derives its own candidate set from the world it finds.
          </p>
          <table className="data">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Plan</th>
                <th>Cost</th>
                <th>Restored slack</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {(run.planningRounds[0] ?? []).map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.id}</td>
                  <td>{c.label}</td>
                  <td className="mono">{Number.isFinite(c.costTotal) ? c.costTotal : '∞'}</td>
                  <td className="mono">{fmtSlack(c.slackMinutes)}</td>
                  <td>
                    {c.acceptable ? (
                      <StatusPill kind="good" label="selected pool" />
                    ) : (
                      <span className="muted">{c.rejectionReason}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="footnote" style={{ marginTop: 14 }}>
            {metrics.verifiedExternalMutations} adapter mutations verified across{' '}
            {metrics.distinctExternalSystems} simulated integration surfaces · {metrics.policyViolations} policy
            violations · repair derived from state, not a scenario id — see the runtime
            variation matrix in CI.
          </p>
        </div>
      </div>
    </main>
  );
}

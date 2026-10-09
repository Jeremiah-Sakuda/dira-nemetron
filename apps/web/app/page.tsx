import Link from 'next/link';
import { SlackChart } from '../components/slack-chart';
import { StatusPill, Tile } from '../components/status';
import { fmtSlack, getGoldenRunData } from '../lib/replay-data';

export const dynamic = 'force-dynamic';

export default async function SystemPage() {
  const data = await getGoldenRunData();
  const { run, metrics } = data;
  const productionConfigured = Boolean(
    process.env.DIRA_CLOUD_RUN_URL && process.env.DIRA_DEMO_TOKEN,
  );
  const feasible = run.status === 'RESOLVED';
  const commitmentCount = data.commitmentsAfter.filter(
    (c) => !c.reservesEffortFor && c.status !== 'DROPPED',
  ).length;
  const atRisk = feasible ? 0 : 1;

  return (
    <main>
      <section className="problem-hero" aria-labelledby="problem-title">
        <div className="panel problem-copy">
          <div className="section-label">When plans collide</div>
          <h1 id="problem-title" className="hero-title">
            One moved commitment can break the whole week.
          </h1>
          <p>
            A midterm moves from Friday to Wednesday. The interview buffer disappears,
            study capacity no longer fits, and a team deliverable is suddenly at risk.
            Calendars show that conflict. Dira repairs it.
          </p>
          <p className="muted">
            It only takes actions already permitted by the people and policies in the plan,
            then verifies the changed world before calling the repair complete.
          </p>
          <div className="hero-actions">
            <Link
              href="/interventions"
              className="btn"
              style={{ textDecoration: 'none', fontSize: 15, padding: '11px 20px' }}
            >
              ▶ Run the 48-Hour Shock
            </Link>
            {productionConfigured && (
              <StatusPill kind="good" label="LIVE CLOUD · Nebius + Calendar" />
            )}
          </div>
        </div>

        <div className="panel impact-story" aria-label="48-Hour Shock: conflict and verified repair">
          <div className="section-label">The 48-Hour Shock</div>
          <div className="story-step story-trigger">
            <span className="story-kicker">External change</span>
            <strong>Midterm: Fri 2 PM → Wed 2 PM</strong>
          </div>
          <div className="story-arrow" aria-hidden="true">↓</div>
          <div className="story-step story-risk">
            <span className="story-kicker">What breaks</span>
            <strong>Interview buffer · study capacity · team QA</strong>
            <span className="mono">GLOBAL SLACK +4.1h → −3.6h</span>
          </div>
          <div className="story-arrow" aria-hidden="true">↓</div>
          <div className="story-step story-repair">
            <span className="story-kicker">Dira&apos;s verified repair</span>
            <strong>Replan, rebook, delegate, rebuild</strong>
            <span className="mono">RESOLVED · +1.3h · 0 HUMAN ACTIONS</span>
          </div>
        </div>
      </section>

      <div className="panel slack-evidence">
        <div className="section-label">Evidence — global slack across the repair</div>
        <SlackChart points={data.slackTrajectory} />
      </div>

      <div className="tile-row">
        <Tile k="Commitments" v={String(commitmentCount)} />
        <Tile k="At risk" v={String(atRisk)} tone={atRisk ? 'critical' : undefined} />
        <Tile k="Interventions (resolved)" v="1" />
        <Tile k="Global slack" v={fmtSlack(run.slackFinalMin ?? 0)} tone={feasible ? 'good' : 'critical'} />
      </div>

      <div className="panel">
        <div className="section-label">What Dira changed in the reference repair</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 16.5 }}>ECON 402 — the 48-Hour Shock</strong>
          <StatusPill kind={feasible ? 'good' : 'warning'} label={run.status} />
        </div>
        <div className="tile-row" style={{ margin: '16px 0 4px' }}>
          <Tile k="Commitments affected" v={String(run.affected.length)} />
          <Tile k="Verified adapter mutations" v={String(metrics.verifiedExternalMutations)} />
          <Tile k="Failures recovered" v={String(metrics.failuresRecovered)} />
          <Tile k="User interventions" v={String(metrics.userInterventions)} tone="good" />
        </div>
        <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginTop: 10 }}>
          A professor email moved the midterm forward 48 hours. Dira re-derived the plan:
          rebooked the interview (surviving a 409 on the first slot), delegated sponsor-deck
          QA to the backup owner, reclaimed two personal blocks, and rebuilt the study plan —
          all policy-gated, ledgered, and independently verified.{' '}
          <Link href="/interventions" style={{ color: 'var(--accent)' }}>
            Open the flight recorder →
          </Link>
        </p>
      </div>

      <p className="footnote">
        Runtime note: this overview is always the reproducible deterministic reference.
        {productionConfigured
          ? ' Production credentials are configured for this deployment; the Interventions page verifies live Cloud Run connectivity per run and labels the boundary.'
          : ' The judge-controlled replay currently uses stateful integration simulators; production credentials are not configured for this web deployment.'}{' '}
        Reproduce the reference with <span className="mono">make demo-replay</span>.
      </p>
    </main>
  );
}

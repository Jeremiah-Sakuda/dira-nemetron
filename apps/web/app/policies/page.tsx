import { DEMO_POLICY_TABLE } from '@dira/policy-engine';
import { StatusPill } from '../../components/status';
import { PolicySettingsForm } from '../../components/policy-settings';

const VERDICT_TONE: Record<string, string> = {
  ALLOW: 'good',
  ALLOW_AND_NOTIFY: 'accent',
  REQUIRE_APPROVAL: 'warning',
  DENY: 'critical',
};

export default function PoliciesPage() {
  return (
    <main>
      <h1 className="page-title">Autonomy policy</h1>
      <p className="page-sub">
        Every mutating operation passes through a deterministic policy gate before it can
        reach the action ledger. Verdicts are code, not prompts: no email, and no model
        output, can widen Dira&rsquo;s authority. Actions without provenance are denied
        unconditionally.
      </p>
      <PolicySettingsForm />
      <div className="grid-2">
        {DEMO_POLICY_TABLE.map((group) => (
          <div className="panel" key={group.verdict}>
            <div style={{ marginBottom: 14 }}>
              <StatusPill kind={VERDICT_TONE[group.verdict] ?? 'neutral'} label={group.verdict} />
            </div>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {group.rules.map((rule) => (
                <li key={rule} style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                  {rule}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="footnote">
        Provenance examples from the golden run: the interview may move to Thu 13:00 because
        gmail-thread-jordan-alt-slots says so; visual QA may delegate to Maya because
        user_policy_config plus a DELEGATABLE_TO edge say so. A candidate action citing
        neither is invalid before policy is even consulted.
      </p>
    </main>
  );
}

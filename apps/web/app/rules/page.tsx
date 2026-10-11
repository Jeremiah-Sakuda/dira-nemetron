import type { Metadata } from 'next';
import { RulesPanel } from '../../components/rules-panel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Rules — Dira' };

export default function RulesPage() {
  return (
    <main>
      <h1 className="page-title">Rules you taught Dira</h1>
      <p className="page-sub">
        When you correct a plan, Dira suggests a narrow rule. Nothing changes until you confirm it. Confirmed rules are committed
        to your private memory repository and mirrored as read-only Skills your Hermes assistant can cite but never change.
      </p>
      <RulesPanel />
    </main>
  );
}

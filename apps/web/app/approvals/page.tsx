import type { Metadata } from 'next';
import { PlanInbox } from '../../components/plan-inbox';
import { ResumablePlans } from '../../components/resumable-plans';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Approvals — Dira' };

export default function ApprovalsPage() {
  return (
    <main className="approvals-page">
      <h1 className="page-title">Approvals</h1>
      <p className="page-sub">
        Plans your policy held for you. Approving re-reads your calendar, re-runs the solver and policy, and only then executes;
        every change is read back before it counts. Correct any step and Dira proposes a rule you can confirm.
      </p>
      <section className="panel">
        <PlanInbox />
      </section>
      <ResumablePlans />
    </main>
  );
}

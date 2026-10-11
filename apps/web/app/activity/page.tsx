import type { Metadata } from 'next';
import { ActivityLog } from '../../components/activity-log';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Activity — Dira' };

export default function ActivityPage() {
  return (
    <main>
      <h1 className="page-title">Activity</h1>
      <p className="page-sub">Every run Dira made for this account, with its flight record: what it read, what Nemotron proposed, what policy decided, and how each change was verified.</p>
      <ActivityLog />
    </main>
  );
}

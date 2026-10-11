import type { Metadata } from 'next';
import Link from 'next/link';
import { AccountGraph } from '../../components/account-graph';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your graph — Dira' };

export default function GraphPage() {
  return (
    <main>
      <h1 className="page-title">Your commitment graph</h1>
      <p className="page-sub">
        What you have promised, to whom, and what depends on what. Everything here was confirmed by you: Nemotron drafts
        commitments and links, but nothing enters the graph until you accept it in <Link href="/onboarding">Setup</Link>.
      </p>
      <AccountGraph />
    </main>
  );
}

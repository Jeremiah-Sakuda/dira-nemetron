'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '../lib/use-session';

const SIGNED_OUT = [
  { href: '/', label: 'Home' },
  { href: '/try', label: 'Try the demo' },
  { href: '/evidence', label: 'Evidence' },
];
const SIGNED_IN = [
  { href: '/today', label: 'Today' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/activity', label: 'Activity' },
  { href: '/graph', label: 'Graph' },
  { href: '/rules', label: 'Rules' },
  { href: '/policies', label: 'Settings' },
  { href: '/onboarding', label: 'Setup' },
  { href: '/evidence', label: 'Evidence' },
];

export function Nav() {
  const pathname = usePathname();
  const session = useSession();
  const links = session.status === 'signed-in'
    ? session.kind === 'demo' ? [{ href: '/try', label: 'Demo' }, ...SIGNED_IN.filter((link) => link.href !== '/onboarding')] : SIGNED_IN
    : SIGNED_OUT;
  return (
    <nav className="nav" aria-label="Main">
      {links.map((link) => (
        <Link key={link.href} href={link.href} data-active={pathname === link.href} aria-current={pathname === link.href ? 'page' : undefined}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function SessionBanner() {
  const session = useSession();
  if (session.kind !== 'demo') return null;
  return (
    <div className="demo-banner" role="note">
      <strong>Demo session</strong> · synthetic people and a simulated calendar, mailbox and slots, isolated to you and deleted after four hours.
    </div>
  );
}

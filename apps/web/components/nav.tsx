'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'System' },
  { href: '/commitments', label: 'Commitments' },
  { href: '/interventions', label: 'Interventions' },
  { href: '/graph', label: 'Graph' },
  { href: '/policies', label: 'Policies' },
  { href: '/activity', label: 'Activity' },
  { href: '/onboarding', label: 'Account' },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} data-active={pathname === l.href}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

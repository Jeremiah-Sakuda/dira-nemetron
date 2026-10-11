import type { Metadata } from 'next';
import './globals.css';
import { Nav, SessionBanner } from '../components/nav';

export const metadata: Metadata = {
  title: 'Dira — your commitments, kept',
  description:
    'Dira notices when a change breaks a promise you made, repairs your week within limits you set, and tells the people affected. NVIDIA Nemotron on Nebius proposes; deterministic code decides.',
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <a className="wordmark" href="/" aria-label="Dira home">
              DIRA<span>▮</span>
            </a>
            <Nav />
          </header>
          <SessionBanner />
          {children}
        </div>
      </body>
    </html>
  );
}

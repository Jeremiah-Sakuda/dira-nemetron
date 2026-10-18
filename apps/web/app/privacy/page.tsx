import Link from 'next/link';

export const metadata = { title: 'Privacy — Dira' };

export default function PrivacyPage() {
  return <main className="legal-page">
    <div className="section-label">Dira Nemotron · Updated October 18, 2026</div>
    <h1 className="page-title">Your information, under your control</h1>
    <p className="page-sub">Dira is an experimental personal assistant built for the Nebius × NVIDIA hackathon. The public demo uses synthetic people and simulated action integrations. Connecting your own Google account is optional.</p>
    <section aria-labelledby="privacy-data"><h2 id="privacy-data">What Dira accesses</h2>
      <p>Google sign-in provides your account identifier, email, profile and Calendar timezone. Read-only Calendar access lets Dira find events and propose commitments. Calendar changes and Gmail read/compose each require separate permission. Gmail compose permission technically permits sending; Dira keeps messages in Drafts until you change the Draft-only policy.</p>
      <p>Connected accounts store confirmed commitments, source references, reviewed relationships, policies, confirmed rules, approval decisions and action history. Credentials are encrypted on the backend and are not given to a model or Hermes sandbox. Google permissions do not automatically enable background processing.</p>
    </section>
    <section aria-labelledby="privacy-model"><h2 id="privacy-model">When information reaches an AI provider</h2>
      <p>Calendar and deadline-feed analysis send event titles and dates to NVIDIA Nemotron models through Nebius Token Factory. Gmail analysis, when you explicitly sync or enable it, sends candidate subjects and up to 8,000 body characters. Dira stores the subject, sender, date, a short evidence quote and the resulting proposal. Review proposals before they enter your commitment graph.</p>
      <p>Do not connect sensitive inboxes during this experimental release. Provider inference retention is governed by your Nebius organization settings and terms; this deployment does not independently attest a zero-retention setting. Dira does not use Google user data to train generalized AI models, sell it, serve advertising, or determine creditworthiness.</p>
      <p>Dira&apos;s use and transfer of information received from Google APIs adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including its Limited Use requirements.</p>
    </section>
    <section aria-labelledby="privacy-storage"><h2 id="privacy-storage">Storage and retention</h2>
      <p>The frontend runs on Vercel. Backend requests and scheduled work run on Google Cloud Run; account data and encrypted private Git-memory bundles are stored in Neon PostgreSQL with account isolation. Private Git memory contains your graph, policies and reusable Skills. You can export it from Setup.</p>
      <p>Flight-record retention defaults to 30 days and can be changed in Settings. Account data remains until you delete it. Deleting an account removes its live database partition, credentials and private memory; it does not undo changes already made in Google. Operator recovery archives are retained separately and require an operator request for removal. Do not include secrets or private content in a public support issue.</p>
    </section>
    <section aria-labelledby="privacy-controls"><h2 id="privacy-controls">Your choices</h2>
      <p>Use Settings to keep drafts only, fence sources and contacts, and choose automatic checks. Sign out to end this device session. Revoke Dira through <a href="https://myaccount.google.com/connections">your Google account connections</a> to stop future Google access. Use Settings to delete your Dira account, and Setup to export private memory.</p>
      <p>For access, deletion or privacy support, <a href="https://github.com/Jeremiah-Sakuda/dira-nemetron/issues">open a content-free support request</a> asking for a private contact channel. Never post email, calendar contents, tokens or backups there.</p>
    </section>
    <p><Link href="/terms">Terms</Link> · <Link href="/onboarding">Account setup</Link> · <Link href="/try">Use the synthetic demo</Link></p>
  </main>;
}

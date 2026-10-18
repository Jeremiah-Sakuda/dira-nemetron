import Link from 'next/link';

export const metadata = { title: 'Terms — Dira' };

export default function TermsPage() {
  return <main className="legal-page">
    <div className="section-label">Dira Nemotron · Updated October 18, 2026</div>
    <h1 className="page-title">An experimental assistant for your commitments</h1>
    <p className="page-sub">Dira is a hackathon prototype. Use the synthetic demo to evaluate it; connect only accounts and test items you control.</p>
    <section><h2>Use and authorization</h2><p>Only connect services you are authorized to access. Review proposed commitments, rules, recipients and actions. You control which tools and permissions are enabled. Approval authorizes the described action after Dira rechecks the current schedule and policy; an action may stop if the state has changed.</p></section>
    <section><h2>External changes</h2><p>Calendar changes and Gmail drafting require separate Google consent. Draft-only is enabled by default. Sending, scheduling or removing an item can affect other people; use synthetic items during evaluation. Revoking access or deleting your Dira account does not reverse changes already made to another service.</p></section>
    <section><h2>Availability and limitations</h2><p>Models can make incorrect proposals. Deterministic validation and independent read-back reduce risk but do not guarantee every plan or provider operation. The service can pause when model credits, free hosting allowances or provider access are unavailable. The credential-free Evidence replay remains the fallback judge path. This prototype is not intended for urgent, medical, legal or other high-stakes decisions.</p></section>
    <section><h2>Open source and support</h2><p>The source code is available under the repository&apos;s <a href="https://github.com/Jeremiah-Sakuda/dira-nemetron/blob/main/LICENSE">open-source license</a>. Review <Link href="/privacy">Privacy</Link> before connecting an account. For support, use the <a href="https://github.com/Jeremiah-Sakuda/dira-nemetron/issues">v2 issue tracker</a> without posting private information.</p></section>
    <p><Link href="/privacy">Privacy</Link> · <Link href="/onboarding">Account setup</Link> · <Link href="/try">Use the synthetic demo</Link></p>
  </main>;
}

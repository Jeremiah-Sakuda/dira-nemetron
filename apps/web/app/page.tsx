import Link from 'next/link';
import { StartButtons } from '../components/start-buttons';

export default function HomePage() {
  return (
    <main className="landing">
      <section className="landing-hero" aria-labelledby="hero-title">
        <div className="section-label">Personal AI · always on · yours</div>
        <h1 id="hero-title" className="landing-title">When one thing moves, Dira fixes everything it breaks.</h1>
        <p className="landing-lede">
          A professor moves your midterm two days earlier. Suddenly your interview is too close, your study time is gone,
          and a teammate is waiting on work you can&rsquo;t do. Dira notices, finds every promise the change breaks, and
          repairs your week within limits you set. It tells the people affected before they have to ask.
        </p>
        <StartButtons />
        <p className="landing-note">The demo is a synthetic student week with a simulated calendar and mailbox. It needs no account and cannot contact real people.</p>
      </section>

      <section className="landing-steps" aria-label="How Dira works">
        <article className="panel">
          <div className="section-label">1 · Notices</div>
          <h2>Always watching the sources you choose</h2>
          <p>Gmail, Google Calendar and course deadline feeds, each connected with its own permission. Dira polls them in the background and keeps a commitment graph of what you promised, to whom, and what depends on what.</p>
        </article>
        <article className="panel">
          <div className="section-label">2 · Repairs</div>
          <h2>Nemotron proposes. Code decides.</h2>
          <p>NVIDIA Nemotron models on Nebius Token Factory read the change and propose repair plans. Deterministic code checks every plan for feasibility, provenance and policy, and you approve anything sensitive. No model output can authorize an action.</p>
        </article>
        <article className="panel">
          <div className="section-label">3 · Remembers</div>
          <h2>Your corrections become your rules</h2>
          <p>Reject or edit a step and Dira suggests a rule. Confirm it and it is committed to a private Git repository you can export, and mirrored as a read-only Skill for your Hermes assistant.</p>
        </article>
      </section>

      <section className="panel landing-boundary" aria-labelledby="boundary-title">
        <h2 id="boundary-title">What the model may and may not do</h2>
        <div className="boundary-grid">
          <div>
            <h3>Nemotron proposes</h3>
            <ul>
              <li>Commitment drafts from your calendar, email and feeds (Nano)</li>
              <li>How an email changes an existing commitment (Super)</li>
              <li>Typed links between commitments and repair plans (Ultra)</li>
            </ul>
          </div>
          <div>
            <h3>Deterministic code decides</h3>
            <ul>
              <li>Whether a plan is feasible and leaves enough slack</li>
              <li>Whether every action cites a stored fact, and who may be contacted</li>
              <li>What runs, what waits for you, and whether each change really happened</li>
            </ul>
          </div>
          <div>
            <h3>You stay in charge</h3>
            <ul>
              <li>Drafts only until you allow sending</li>
              <li>Fence a calendar, your inbox, or a contact</li>
              <li>Export or delete everything at any time</li>
            </ul>
          </div>
        </div>
      </section>

      <p className="footnote">Engine proofs, including the deterministic replay, the 20-run reliability check and the variation matrix, are on the <Link href="/evidence">Evidence</Link> page.</p>
    </main>
  );
}

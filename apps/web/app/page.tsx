import Link from 'next/link';
import { StartButtons } from '../components/start-buttons';

export default function HomePage() {
  return (
    <main className="landing">
      <section className="landing-hero" aria-labelledby="hero-title">
        <div className="section-label">Personal AI · persistent memory · yours</div>
        <h1 id="hero-title" className="landing-title">When one thing moves, protect the promises connected to it.</h1>
        <p className="landing-lede">
          A professor moves your midterm two days earlier. Suddenly your interview is too close, your study time is gone,
          and a teammate is waiting on work you can&rsquo;t do. Dira checks the commitments and dependencies you have reviewed, then
          proposes a feasible repair within limits you set. It prepares updates for the people affected, with drafts only by default.
        </p>
        <StartButtons />
        <p className="landing-note">The demo is a synthetic student week with a simulated calendar and mailbox. It needs no account and cannot contact real people.</p>
      </section>

      <section className="landing-steps" aria-label="How Dira works">
        <article className="panel">
          <div className="section-label">1 · Notices</div>
          <h2>Scheduled checks for sources you opt into</h2>
          <p>Gmail, Google Calendar and course deadline feeds each have their own permission. Background checks require owner opt-in and deployment enrollment; they are not enabled by connecting an account. Dira keeps a graph of what you promised and what depends on what.</p>
        </article>
        <article className="panel">
          <div className="section-label">2 · Repairs</div>
          <h2>Nemotron proposes. Code decides.</h2>
          <p>NVIDIA Nemotron models on Nebius Token Factory read the change and propose repair plans. Deterministic code checks every plan for feasibility, provenance and policy, and you approve anything sensitive. No model output can authorize an action.</p>
        </article>
        <article className="panel">
          <div className="section-label">3 · Remembers</div>
          <h2>Your corrections become your rules</h2>
          <p>Reject or edit a step and Dira suggests a rule. Confirm it and it is committed to a private Git repository you can export, with a reusable Skill for an optional Hermes companion. The owner runtime is a separate enrollment step.</p>
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

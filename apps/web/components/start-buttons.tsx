'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { startDemo, useSession } from '../lib/use-session';

export function StartButtons() {
  const router = useRouter();
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function demo() {
    setBusy(true); setError('');
    try {
      await startDemo();
      router.push('/try');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <div className="landing-actions">
      {session.status === 'signed-in' && session.kind === 'google' ? (
        <a className="btn btn-large" href="/today">Open your Today view</a>
      ) : (
        <button className="btn btn-large" type="button" onClick={() => void demo()} disabled={busy}>
          {busy ? 'Creating your demo…' : session.kind === 'demo' ? 'Restart the demo' : 'Try the demo, no sign-in'}
        </button>
      )}
      {session.kind === 'demo' && <a className="btn btn-secondary btn-large" href="/try">Back to your demo</a>}
      {session.status !== 'signed-in' || session.kind === 'demo' ? (
        <a className="btn btn-secondary btn-large" href="/api/auth/google/start">Sign in with Google</a>
      ) : null}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { readJson } from '../lib/format';
import { useSession } from '../lib/use-session';

interface TelegramStatus { configured: boolean; linked: boolean; linkedAtIso: string | null }
interface HermesStatus { mcpUrl: string; token: { createdAtIso: string; lastUsedAtIso: string | null } | null }

/** Telegram approvals and the Hermes connection. Neither can approve anything on its own. */
export function MessagingSettings() {
  const session = useSession();
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [hermes, setHermes] = useState<HermesStatus | null>(null);
  const [newToken, setNewToken] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const [telegramResponse, hermesResponse] = await Promise.all([
      fetch('/api/telegram/link', { cache: 'no-store' }), fetch('/api/hermes/token', { cache: 'no-store' }),
    ]);
    if (telegramResponse.ok) setTelegram(await readJson<TelegramStatus>(telegramResponse));
    if (hermesResponse.ok) setHermes(await readJson<HermesStatus>(hermesResponse));
  }
  useEffect(() => { if (session.status === 'signed-in') void load(); }, [session.status]);

  async function link() {
    setError('');
    const response = await fetch('/api/telegram/link', { method: 'POST' });
    const body = await readJson<{ url: string }>(response);
    if (!response.ok) { setError(body.error ?? 'Telegram linking failed.'); return; }
    setLinkUrl(body.url);
  }
  async function unlink() {
    await fetch('/api/telegram/link', { method: 'DELETE' });
    setLinkUrl('');
    await load();
  }
  async function createToken() {
    setError('');
    const response = await fetch('/api/hermes/token', { method: 'POST' });
    const body = await readJson<{ token: string }>(response);
    if (!response.ok) { setError(body.error ?? 'The token could not be created.'); return; }
    setNewToken(body.token);
    await load();
  }
  async function revoke() {
    await fetch('/api/hermes/token', { method: 'DELETE' });
    setNewToken('');
    await load();
  }

  if (session.status !== 'signed-in') return null;
  return (
    <section className="panel policy-settings" aria-labelledby="messaging-title">
      <div className="section-label">Chat</div>
      <h2 id="messaging-title">Telegram and Hermes</h2>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="messaging-grid">
        <div>
          <h3>Approve from your phone</h3>
          <p className="muted">Dira&rsquo;s own Telegram bot sends Approve and Reject buttons. Each button works once, only in your linked chat, and goes straight to Dira&rsquo;s broker without passing through any model. The 07:00 summary arrives here too.</p>
          {!telegram?.configured ? <p className="muted">Telegram is not configured on this deployment.</p>
            : telegram.linked ? (
              <div className="proposal-actions"><span className="status-pill pill-good">Linked</span>
                <button className="btn btn-secondary" type="button" onClick={() => void unlink()}>Unlink</button></div>
            ) : linkUrl ? (
              <p>Open <a className="mono" href={linkUrl} target="_blank" rel="noreferrer">{linkUrl}</a> on your phone and press Start within 15 minutes, then refresh this page.</p>
            ) : <button className="btn" type="button" onClick={() => void link()}>Link Telegram</button>}
        </div>
        <div>
          <h3>Talk to Hermes</h3>
          <p className="muted">Hermes Agent, running in your NemoClaw sandbox, can read your schedule, explain what Dira did, and relay changes you tell it. It cannot approve, confirm or send anything.</p>
          {session.kind === 'demo' ? <p className="muted">Connect Hermes from a signed-in account.</p> : (
            <>
              <p className="mono allowlist">MCP endpoint: {hermes?.mcpUrl ?? '…'}</p>
              {newToken ? (
                <div className="token-reveal" role="status">
                  <p>Copy this token now; Dira stores only its hash.</p>
                  <code>{newToken}</code>
                  <pre className="mono">{`nemohermes <sandbox> mcp add dira --url ${hermes?.mcpUrl ?? '<url>'} --env DIRA_HERMES_TOKEN`}</pre>
                </div>
              ) : hermes?.token ? (
                <p className="muted">Token created {new Date(hermes.token.createdAtIso).toLocaleDateString()}{hermes.token.lastUsedAtIso ? `, last used ${new Date(hermes.token.lastUsedAtIso).toLocaleString()}` : ', not used yet'}.</p>
              ) : null}
              <div className="proposal-actions">
                <button className="btn" type="button" onClick={() => void createToken()}>{hermes?.token ? 'Replace token' : 'Create Hermes token'}</button>
                {hermes?.token && <button className="btn btn-secondary" type="button" onClick={() => void revoke()}>Revoke</button>}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

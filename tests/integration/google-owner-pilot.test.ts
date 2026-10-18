import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginGoogleOAuth, completeGoogleOAuth, googleAccountAllowed } from '../../services/orchestrator/src/google-auth.js';
import type { IncomingMessage } from 'node:http';
import type { PostgresAccountStore } from '../../services/orchestrator/src/postgres-store.js';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('Google owner pilot enrollment',()=>{
  it('preserves unconfigured local setups',()=>{delete process.env.DIRA_GOOGLE_ALLOWED_EMAILS;expect(googleAccountAllowed('someone@example.com')).toBe(true);});
  it('matches only exact configured addresses ignoring case and surrounding whitespace',()=>{vi.stubEnv('DIRA_GOOGLE_ALLOWED_EMAILS',' Owner@Example.com , second@example.com ');expect(googleAccountAllowed('owner@example.com')).toBe(true);expect(googleAccountAllowed('bad-owner@example.com')).toBe(false);expect(googleAccountAllowed('owner@example.com.attacker.test')).toBe(false);});
  it('fails closed when explicitly empty',()=>{vi.stubEnv('DIRA_GOOGLE_ALLOWED_EMAILS','');expect(googleAccountAllowed('owner@example.com')).toBe(false);});
  it('rejects outsiders before storing an account, credential or graph',async()=>{
    vi.stubEnv('DIRA_GOOGLE_ALLOWED_EMAILS','owner@example.com');vi.stubEnv('GOOGLE_CLIENT_ID','synthetic-client');vi.stubEnv('GOOGLE_CLIENT_SECRET','synthetic-secret');vi.stubEnv('GOOGLE_REDIRECT_URI','https://dira.example/auth/google/callback');vi.stubEnv('DIRA_SESSION_SECRET','synthetic-session-secret-at-least-32-chars');
    const start=beginGoogleOAuth();const state=new URL(start.authorizationUrl).searchParams.get('state')!;
    const fetchMock=vi.fn().mockResolvedValueOnce(Response.json({access_token:'synthetic-token'})).mockResolvedValueOnce(Response.json({sub:'synthetic-outsider',email:'outsider@example.com',email_verified:true}));vi.stubGlobal('fetch',fetchMock);
    const store={saveAccount:vi.fn(),saveCredential:vi.fn(),ensureDomainState:vi.fn()} as unknown as PostgresAccountStore;
    await expect(completeGoogleOAuth({headers:{cookie:start.stateCookie.split(';')[0]}} as IncomingMessage,'synthetic-code',state,store)).rejects.toThrow('owner pilot');
    expect(store.saveAccount).not.toHaveBeenCalled();expect(store.saveCredential).not.toHaveBeenCalled();expect(store.ensureDomainState).not.toHaveBeenCalled();expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

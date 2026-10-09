import {
  createCipheriv,
  createHash,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { EncryptedCredential, PostgresAccountStore } from './postgres-store.js';

const PROVIDER = 'google';
const SESSION_COOKIE = 'dira_session';
const STATE_COOKIE = 'dira_oauth_state';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.settings.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
];

interface SignedPayload {
  value: string;
  expiresAt: number;
}

interface OAuthState extends SignedPayload {
  verifier: string;
}

export interface GoogleIdentity {
  accountId: string;
  email: string;
  timezone: string;
}

export interface OAuthStart {
  authorizationUrl: string;
  stateCookie: string;
}

export interface OAuthComplete {
  accountId: string;
  sessionCookie: string;
  clearStateCookie: string;
}

interface StoredGoogleTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: number;
}

export function beginGoogleOAuth(): OAuthStart {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const payload: OAuthState = {
    value: state,
    verifier,
    expiresAt: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS,
  };
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizationUrl.search = new URLSearchParams({
    client_id: requiredEnv('GOOGLE_CLIENT_ID'),
    redirect_uri: requiredEnv('GOOGLE_REDIRECT_URI'),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    include_granted_scopes: 'true',
  }).toString();
  return {
    authorizationUrl: authorizationUrl.toString(),
    stateCookie: signedCookie(STATE_COOKIE, payload, OAUTH_STATE_TTL_SECONDS, '/auth/google'),
  };
}

export async function completeGoogleOAuth(
  request: IncomingMessage,
  code: string,
  state: string,
  store: PostgresAccountStore,
): Promise<OAuthComplete> {
  const signedState = readSignedCookie<OAuthState>(request, STATE_COOKIE);
  if (!signedState || signedState.value !== state || !signedState.verifier) {
    throw new Error('invalid OAuth state');
  }
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: requiredEnv('GOOGLE_CLIENT_ID'),
      client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
      redirect_uri: requiredEnv('GOOGLE_REDIRECT_URI'),
      grant_type: 'authorization_code',
      code_verifier: signedState.verifier,
    }),
  });
  if (!tokenResponse.ok) throw new Error(`Google token exchange failed (${tokenResponse.status})`);
  const token = await tokenResponse.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    id_token?: string;
  };
  if (!token.access_token) throw new Error('Google returned no access token');

  const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!userResponse.ok) throw new Error(`Google identity lookup failed (${userResponse.status})`);
  const user = await userResponse.json() as { sub?: string; email?: string; email_verified?: boolean };
  if (!user.sub || !user.email || user.email_verified !== true) {
    throw new Error('Google account identity is missing a verified email');
  }

  const timezoneResponse = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/settings/timezone',
    { headers: { authorization: `Bearer ${token.access_token}` } },
  );
  if (!timezoneResponse.ok) throw new Error(`Google Calendar timezone lookup failed (${timezoneResponse.status})`);
  const timezoneSetting = await timezoneResponse.json() as { value?: string };
  const timezone = timezoneSetting.value;
  if (!timezone || !isValidTimeZone(timezone)) throw new Error('Google returned an invalid calendar timezone');

  const existingCredential = await store.getCredential(user.sub, PROVIDER);
  const previousTokens = existingCredential
    ? decryptCredential<StoredGoogleTokens>(existingCredential)
    : undefined;
  const refreshToken = token.refresh_token ?? previousTokens?.refreshToken;
  const encrypted = encryptCredential({
    accessToken: token.access_token,
    refreshToken,
    tokenType: token.token_type,
    scope: token.scope,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
  });
  await store.saveAccount({ accountId: user.sub, email: user.email, timezone });
  await store.saveCredential(user.sub, PROVIDER, {
    ...encrypted,
    scopes: token.scope?.split(' ') ?? [],
    expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined,
  });

  const session = signedCookie(SESSION_COOKIE, {
    value: user.sub,
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }, SESSION_TTL_SECONDS, '/');
  return {
    accountId: user.sub,
    sessionCookie: session,
    clearStateCookie: clearCookie(STATE_COOKIE, '/auth/google'),
  };
}

export function getSessionAccountId(request: IncomingMessage): string | undefined {
  return readSignedCookie<SignedPayload>(request, SESSION_COOKIE)?.value;
}

export function clearSessionCookie(): string {
  return clearCookie(SESSION_COOKIE, '/');
}

/** Return a current Google access token to trusted server-side adapters only. */
export async function googleAccessToken(
  store: PostgresAccountStore,
  accountId: string,
): Promise<string> {
  const credential = await store.getCredential(accountId, PROVIDER);
  if (!credential) throw new Error('Google account is not connected');
  const token = decryptCredential<StoredGoogleTokens>(credential);
  if (!token.expiresAt || token.expiresAt > Date.now() + 60_000) return token.accessToken;
  if (!token.refreshToken) throw new Error('Google access expired; reconnect the Google account');

  const refreshed = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requiredEnv('GOOGLE_CLIENT_ID'),
      client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
      refresh_token: token.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!refreshed.ok) throw new Error(`Google token refresh failed (${refreshed.status})`);
  const data = await refreshed.json() as { access_token?: string; expires_in?: number; scope?: string };
  if (!data.access_token || !data.expires_in) throw new Error('Google returned an incomplete token refresh');
  const next: StoredGoogleTokens = {
    ...token,
    accessToken: data.access_token,
    scope: data.scope ?? token.scope,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  const encrypted = encryptCredential(next);
  await store.saveCredential(accountId, PROVIDER, {
    ...encrypted,
    scopes: (next.scope ?? '').split(' ').filter(Boolean),
    expiresAt: new Date(next.expiresAt!),
  });
  return next.accessToken;
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return origin === requiredEnv('DIRA_WEB_ORIGIN');
}

function encryptCredential(value: unknown): Omit<EncryptedCredential, 'scopes' | 'expiresAt'> {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: 1,
  };
}

function decryptCredential<T>(credential: EncryptedCredential): T {
  if (credential.keyVersion !== 1) throw new Error(`unsupported Google credential key version ${credential.keyVersion}`);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(credential.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(credential.authTag, 'base64'));
  const cleartext = Buffer.concat([
    decipher.update(Buffer.from(credential.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(cleartext) as T;
}

function signedCookie(name: string, payload: SignedPayload, maxAge: number, path: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', sessionSecret()).update(encoded).digest('base64url');
  return `${name}=${encoded}.${signature}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secureCookie()}`;
}

function readSignedCookie<T extends SignedPayload>(request: IncomingMessage, name: string): T | undefined {
  const pair = (request.headers.cookie ?? '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!pair) return undefined;
  const signed = pair.slice(name.length + 1);
  const separator = signed.lastIndexOf('.');
  if (separator < 1) return undefined;
  const encoded = signed.slice(0, separator);
  const supplied = Buffer.from(signed.slice(separator + 1));
  const expected = Buffer.from(createHmac('sha256', sessionSecret()).update(encoded).digest('base64url'));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T;
    return payload.expiresAt > Math.floor(Date.now() / 1000) && payload.value
      ? payload
      : undefined;
  } catch {
    return undefined;
  }
}

function clearCookie(name: string, path: string): string {
  return `${name}=; Path=${path}; Max-Age=0; HttpOnly; SameSite=Lax${secureCookie()}`;
}

function secureCookie(): string {
  return process.env.NODE_ENV === 'production' ? '; Secure' : '';
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Google sign-in`);
  return value;
}

function sessionSecret(): string {
  const value = requiredEnv('DIRA_SESSION_SECRET');
  if (Buffer.byteLength(value) < 32) throw new Error('DIRA_SESSION_SECRET must be at least 32 bytes');
  return value;
}

function encryptionKey(): Buffer {
  const value = requiredEnv('DIRA_TOKEN_ENCRYPTION_KEY');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('DIRA_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return key;
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

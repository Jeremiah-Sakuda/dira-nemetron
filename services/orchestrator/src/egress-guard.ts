import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Application egress guard. Every fetch() made by the orchestrator process
 * goes through an allowlist of the hosts Dira needs (Token Factory, Google
 * OAuth/Calendar/Gmail, Telegram, Tavily). Anything else gets a synthetic 403
 * and an audit line, and never leaves the process.
 *
 * In deployment the same allowlist is enforced a second time at the network
 * boundary by the OpenShell sandbox proxy (infrastructure/nebius/openshell),
 * which also covers code paths that do not use fetch. User-chosen deadline
 * feeds use their own IP-pinned HTTPS client and are allowed per feed.
 */

export const DEFAULT_EGRESS_ALLOWLIST = [
  'api.tokenfactory.nebius.com',
  'oauth2.googleapis.com',
  'openidconnect.googleapis.com',
  'www.googleapis.com',
  'gmail.googleapis.com',
  'calendar-json.googleapis.com',
  'api.telegram.org',
  'api.tavily.com',
];

export interface EgressDecision {
  host: string;
  url: string;
  verdict: 'DENIED' | 'ALLOWED';
  statusCode: number;
  purpose: string;
  atIso: string;
  accountId?: string;
}

interface EgressContext {
  accountId?: string;
  purpose: string;
  onDecision?: (decision: EgressDecision) => Promise<void> | void;
}

const context = new AsyncLocalStorage<EgressContext>();
const recent: EgressDecision[] = [];
let installed = false;
let originalFetch: typeof fetch | undefined;

export function egressAllowlist(): string[] {
  const configured = process.env.DIRA_EGRESS_ALLOWLIST?.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  return configured?.length ? configured : DEFAULT_EGRESS_ALLOWLIST;
}

export function isAllowedHost(host: string, allowlist = egressAllowlist()): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, '');
  return allowlist.some((entry) => entry.startsWith('*.')
    ? normalized.endsWith(entry.slice(1)) && normalized.length > entry.length - 1
    : normalized === entry);
}

/** Run `operation` with account context so denied requests are audited to that account. */
export function withEgressContext<T>(value: EgressContext, operation: () => Promise<T>): Promise<T> {
  return context.run(value, operation);
}

export function recentEgressDecisions(): EgressDecision[] {
  return [...recent];
}

/** Patch the process-wide fetch. Idempotent. Set DIRA_EGRESS_GUARD=off to disable for local debugging. */
export function installEgressGuard(): void {
  if (installed || process.env.DIRA_EGRESS_GUARD === 'off') return;
  installed = true;
  originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') {
      return originalFetch!(input, init);
    }
    const scope = context.getStore();
    if (!isAllowedHost(url.hostname)) {
      const decision: EgressDecision = {
        host: url.hostname, url: `${url.origin}${url.pathname}`, verdict: 'DENIED', statusCode: 403,
        purpose: scope?.purpose ?? 'unscoped', atIso: new Date().toISOString(),
        ...(scope?.accountId ? { accountId: scope.accountId } : {}),
      };
      remember(decision);
      await scope?.onDecision?.(decision);
      console.warn(`egress denied: ${decision.host} (${decision.purpose})`);
      return new Response(JSON.stringify({ error: 'egress_denied', host: url.hostname, policy: 'dira-egress-allowlist' }), {
        status: 403,
        headers: { 'content-type': 'application/json', 'x-dira-egress': 'denied' },
      });
    }
    return originalFetch!(input, init);
  }) as typeof fetch;
}

function remember(decision: EgressDecision): void {
  recent.unshift(decision);
  if (recent.length > 200) recent.length = 200;
}

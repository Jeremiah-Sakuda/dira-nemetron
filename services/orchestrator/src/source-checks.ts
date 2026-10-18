import { createHash } from 'node:crypto';
import { WEB_SOURCE_PREFIX, type DomainState } from '@dira/commitment-model';
import type { RawEmailEvent } from '@dira/event-schema';
import { handleAccountEmail, type AccountRepairOptions } from './account-repair.js';
import type { PostgresAccountStore } from './postgres-store.js';

/**
 * Official-source checks with Tavily (PRD P1).
 *
 * The owner names one public domain (a course site, an event page) as the
 * official source for a commitment. Dira searches only that domain with
 * Tavily. Each result whose URL is on that domain becomes an untrusted
 * `web_page` event and goes through the same path as an email: Super
 * interpretation, entity resolution, commitment-scoped authority (the source
 * is a participant only of that commitment), a verbatim evidence quote from
 * the fetched text, then propagation, planning, policy and approval. A web
 * source can never be contacted.
 */

export interface SourceCheckResult {
  commitmentId: string;
  domain: string;
  results: number;
  considered: { url: string; title: string; status: string; reason?: string; workflowId?: string }[];
  tavily: { responseTimeSec?: number; requestId?: string };
}

export function tavilyConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

export function normalizeDomain(input: string): string {
  const value = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)) {
    throw new Error('Enter a public domain such as econ402.university.edu.');
  }
  return value;
}

export function webSourceId(domain: string): string {
  return `${WEB_SOURCE_PREFIX}${createHash('sha256').update(domain).digest('hex').slice(0, 16)}`;
}

/** Name `domain` as the official source for one commitment. Only the owner can do this (authenticated route). */
export async function registerSourceCheck(store: PostgresAccountStore, accountId: string, commitmentId: string, domainInput: string) {
  const domain = normalizeDomain(domainInput);
  const state = await store.loadDomainState(accountId);
  const commitment = state?.commitments[commitmentId];
  if (!state || !commitment || commitment.status === 'DROPPED') throw new Error('That commitment is not in your graph.');
  const id = webSourceId(domain);
  state.people[id] = {
    id,
    name: `Official page: ${domain}`,
    email: `web@${domain}`,
    authorityDomains: [...new Set([...(state.people[id]?.authorityDomains ?? []), commitment.domain])],
  };
  // Remove any previous official source for this commitment, then add this one.
  commitment.participants = commitment.participants.filter((participant) => !participant.startsWith(WEB_SOURCE_PREFIX)).concat(id);
  await store.saveDomainState(accountId, state);
  return { commitmentId, domain };
}

export function listSourceChecks(state: DomainState) {
  return Object.values(state.commitments)
    .filter((commitment) => commitment.status !== 'DROPPED')
    .flatMap((commitment) => commitment.participants
      .filter((participant) => participant.startsWith(WEB_SOURCE_PREFIX))
      .map((participant) => ({
        commitmentId: commitment.id,
        title: commitment.title,
        domain: state.people[participant]?.email.replace(/^web@/, '') ?? 'unknown',
      })));
}

interface TavilyResponse {
  results?: { title?: string; url?: string; content?: string; published_date?: string }[];
  response_time?: number;
  request_id?: string;
}

export async function runSourceCheck(
  store: PostgresAccountStore,
  accountId: string,
  commitmentId: string,
  options: AccountRepairOptions & { fetchImpl?: typeof fetch } = {},
): Promise<SourceCheckResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('Tavily is not configured on this deployment (TAVILY_API_KEY).');
  const state = await store.loadDomainState(accountId);
  const check = state ? listSourceChecks(state).find((item) => item.commitmentId === commitmentId) : undefined;
  if (!state || !check) throw new Error('Name an official page for this commitment first.');

  const response = await (options.fetchImpl ?? fetch)('https://api.tavily.com/search', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `"${check.title.slice(0, 120)}" date time`,
      include_domains: [check.domain],
      search_depth: 'basic',
      max_results: 3,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Tavily search failed (HTTP ${response.status})`);
  const payload = await response.json() as TavilyResponse;

  const considered: SourceCheckResult['considered'] = [];
  for (const result of payload.results ?? []) {
    const url = result.url ?? '';
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch { /* invalid URL */ }
    if (!host || !(host === check.domain || host.endsWith(`.${check.domain}`))) {
      considered.push({ url, title: result.title ?? '', status: 'SKIPPED', reason: 'not on the official domain' });
      continue;
    }
    const content = (result.content ?? '').slice(0, 8_000);
    if (!content.trim()) {
      considered.push({ url, title: result.title ?? '', status: 'SKIPPED', reason: 'no page text' });
      continue;
    }
    // Same page text → same event id, so an unchanged page never re-runs.
    const digest = createHash('sha256').update(`${url}\n${content}`).digest('hex').slice(0, 24);
    const event: RawEmailEvent = {
      eventId: `web-${digest}`,
      source: 'web_page',
      threadId: url.slice(0, 500),
      messageId: `web-${digest}`,
      from: `web@${check.domain}`,
      to: 'owner',
      subject: (result.title ?? check.domain).slice(0, 200),
      body: content,
      receivedAtIso: (options.now ?? (()=>new Date()))().toISOString(),
    };
    const outcome = await handleAccountEmail(store, accountId, event, options);
    considered.push({
      url, title: result.title ?? '', status: outcome.run.status,
      ...(outcome.run.statusReason ? { reason: outcome.run.statusReason } : {}),
      workflowId: outcome.run.id,
    });
  }
  return {
    commitmentId,
    domain: check.domain,
    results: payload.results?.length ?? 0,
    considered,
    tavily: { responseTimeSec: payload.response_time, requestId: payload.request_id },
  };
}

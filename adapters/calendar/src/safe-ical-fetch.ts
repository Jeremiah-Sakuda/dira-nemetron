import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request, type RequestOptions } from 'node:https';

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

export class IcalFetchError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'IcalFetchError';
  }
}

export interface IcalFetchState {
  etag?: string;
  lastModified?: string;
}

export type IcalFetchResult =
  | { notModified: true; etag?: string; lastModified?: string }
  | { notModified: false; body: string; etag?: string; lastModified?: string };

/** HTTPS-only fetch with pinned public IPv4 DNS, bounded redirects and response size. */
export async function fetchIcalFeed(rawUrl: string, state: IcalFetchState = {}): Promise<IcalFetchResult> {
  let url = normalizeIcalUrl(rawUrl);
  let conditionals = state;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const address = await resolvePublicAddress(url.hostname);
    const result = await requestOnce(url, address, conditionals);
    if (result.status === 304) {
      return { notModified: true, etag: result.etag ?? state.etag, lastModified: result.lastModified ?? state.lastModified };
    }
    if (result.status >= 300 && result.status < 400 && result.location) {
      if (redirects === MAX_REDIRECTS) throw new IcalFetchError('REDIRECT_LIMIT', 'The feed redirected too many times.');
      const next = new URL(result.location, url);
      url = normalizeIcalUrl(next.toString());
      conditionals = {};
      continue;
    }
    if (result.status < 200 || result.status >= 300) {
      throw new IcalFetchError('HTTP_STATUS', `The feed server returned HTTP ${result.status}.`);
    }
    if (result.body.length > MAX_FEED_BYTES) throw new IcalFetchError('FEED_TOO_LARGE', 'The feed exceeds the 2 MB limit.');
    const contentType = (result.contentType ?? '').split(';', 1)[0]!.trim().toLowerCase();
    if (contentType && !['text/calendar', 'text/plain', 'application/ics', 'application/octet-stream'].includes(contentType)) {
      throw new IcalFetchError('CONTENT_TYPE', 'The feed server did not return an iCalendar-compatible content type.');
    }
    return { notModified: false, body: result.body, etag: result.etag, lastModified: result.lastModified };
  }
  throw new IcalFetchError('REDIRECT_LIMIT', 'The feed redirected too many times.');
}

export function normalizeIcalUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
    if (url.protocol === 'webcal:') url.protocol = 'https:';
  } catch {
    throw new IcalFetchError('INVALID_URL', 'Enter a valid HTTPS iCalendar feed URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443'
    || url.hostname.endsWith('.') || url.hash) {
    throw new IcalFetchError('URL_NOT_ALLOWED', 'Only public HTTPS iCalendar URLs on port 443 are supported.');
  }
  return url;
}

async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: 4 }> {
  if (isIP(hostname) === 6) throw new IcalFetchError('IPV6_NOT_SUPPORTED', 'IPv6 feed hosts are not supported.');
  try {
    const addresses = await lookup(hostname, { all: true, family: 4, verbatim: true });
    const selected = addresses.find((item) => isPublicIpv4(item.address));
    if (!selected || addresses.some((item) => !isPublicIpv4(item.address))) {
      throw new IcalFetchError('DNS_NOT_PUBLIC', 'The feed host must resolve only to public IPv4 addresses.');
    }
    return { address: selected.address, family: 4 };
  } catch (error) {
    if (error instanceof IcalFetchError) throw error;
    throw new IcalFetchError('DNS_LOOKUP_FAILED', 'The feed host could not be resolved safely.');
  }
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 255) return false;
  if (a === 100 && b! >= 64 && b! <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b! >= 16 && b! <= 31) return false;
  if (a === 192 && (b === 0 || b === 168 || b === 88 && c === 99)) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function requestOnce(url: URL, pinned: { address: string; family: number }, state: IcalFetchState): Promise<{
  status: number; location?: string; contentType?: string; etag?: string; lastModified?: string; body: string;
}> {
  return new Promise((resolve, reject) => {
    const lookupPinned = ((_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
      callback(null, pinned.address, pinned.family);
    }) as unknown as NonNullable<RequestOptions['lookup']>;
    const req = request(url, {
      method: 'GET',
      servername: url.hostname,
      lookup: lookupPinned,
      headers: {
        accept: 'text/calendar, text/plain;q=0.9, application/ics;q=0.8, */*;q=0.1',
        'user-agent': 'Dira-Deadline-Feed/1.0',
        ...(state.etag ? { 'if-none-match': state.etag } : {}),
        ...(state.lastModified ? { 'if-modified-since': state.lastModified } : {}),
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const headers = response.headers;
      const base = {
        status,
        location: typeof headers.location === 'string' ? headers.location : undefined,
        contentType: typeof headers['content-type'] === 'string' ? headers['content-type'] : undefined,
        etag: typeof headers.etag === 'string' ? headers.etag.slice(0, 500) : undefined,
        lastModified: typeof headers['last-modified'] === 'string' ? headers['last-modified'].slice(0, 200) : undefined,
      };
      if (status === 304 || status >= 300 && status < 400) {
        response.resume();
        response.on('end', () => resolve({ ...base, body: '' }));
        return;
      }
      const declaredLength = Number(headers['content-length'] ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_FEED_BYTES) {
        req.destroy(new IcalFetchError('FEED_TOO_LARGE', 'The feed exceeds the 2 MB limit.'));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > MAX_FEED_BYTES) {
          req.destroy(new IcalFetchError('FEED_TOO_LARGE', 'The feed exceeds the 2 MB limit.'));
          return;
        }
        chunks.push(buffer);
      });
      response.on('end', () => resolve({ ...base, body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new IcalFetchError('FETCH_TIMEOUT', 'The feed request timed out.')));
    req.on('error', reject);
    req.end();
  });
}

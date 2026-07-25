/**
 * The network layer.
 *
 * Every provider Epoch talks to is free and needs no key, which also means none
 * of them owe you an SLA. So every request here is time-boxed, retried once on
 * a transient failure, cached, and — critically — allowed to fail without
 * taking the simulation down with it. A world with stale weather is still a
 * world; a world that halts because Nominatim was slow is not.
 */

export interface FetchOptions {
  /** Cache lifetime in milliseconds. 0 disables caching for this call. */
  ttlMs?: number;
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Nominatim and several other OSM-adjacent services ask for a contact string.
 * Set EPOCH_CONTACT_EMAIL to be a good citizen; it is optional.
 */
export function userAgent(): string {
  const contact = process.env.EPOCH_CONTACT_EMAIL;
  return `epoch-engine/0.1 (+https://github.com/rayhankhilji/epoch-engine${contact ? `; ${contact}` : ''})`;
}

export class HttpError extends Error {
  readonly status: number | undefined;
  readonly url: string;

  constructor(message: string, url: string, status?: number) {
    super(message);
    this.name = 'HttpError';
    this.url = url;
    this.status = status;
  }
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const ttl = options.ttlMs ?? 10 * 60_000;
  const key = `json:${url}`;

  const hit = ttl > 0 ? read<T>(key) : undefined;
  if (hit !== undefined) return hit;

  const text = await request(url, { ...options, accept: 'application/json' });
  let value: T;
  try {
    value = JSON.parse(text) as T;
  } catch {
    throw new HttpError(`Response was not JSON: ${text.slice(0, 120)}`, url);
  }

  if (ttl > 0) write(key, value, ttl);
  return value;
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const ttl = options.ttlMs ?? 10 * 60_000;
  const key = `text:${url}`;

  const hit = ttl > 0 ? read<string>(key) : undefined;
  if (hit !== undefined) return hit;

  const text = await request(url, { ...options, accept: 'text/plain, text/csv, */*' });
  if (ttl > 0) write(key, text, ttl);
  return text;
}

async function request(url: string, options: FetchOptions & { accept: string }): Promise<string> {
  const retries = options.retries ?? 1;
  const timeoutMs = options.timeoutMs ?? 12_000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort);

    // Tracked separately from the throw: a client error must end the loop, and
    // throwing here would be caught by this function's own catch and retried.
    let fatal = false;

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'user-agent': userAgent(),
          accept: options.accept,
          ...options.headers,
        },
      });

      if (response.ok) return await response.text();

      // 4xx other than 429 means the request itself is wrong; retrying it just
      // wastes another second of a free service's goodwill.
      fatal = !(response.status === 429 || response.status >= 500);
      lastError = new HttpError(`${response.status} ${response.statusText}`, url, response.status);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }

    if (fatal || attempt === retries) break;
    await sleep(500 * (attempt + 1) * (0.8 + Math.random() * 0.4));
  }

  throw lastError instanceof Error ? lastError : new HttpError(String(lastError), url);
}

function read<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function write(key: string, value: unknown, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  // Keep the cache from growing without bound over a long-running world.
  if (cache.size > 500) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt).slice(0, 100);
    for (const [staleKey] of oldest) cache.delete(staleKey);
  }
}

export function clearHttpCache(): void {
  cache.clear();
}

/**
 * Run a provider and return `fallback` if it fails. Live data is a bonus, never
 * a dependency — this is the function that guarantees that.
 */
export async function tolerate<T>(
  label: string,
  work: () => Promise<T>,
  fallback: T,
  onWarning?: (message: string, detail?: unknown) => void,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    onWarning?.(`${label} unavailable — continuing without it`, error);
    return fallback;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

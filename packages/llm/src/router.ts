/**
 * The router.
 *
 * `createMind()` returns the `MindFn` that `@epoch/core` calls whenever an
 * agent needs to think. It resolves the agent's configured provider, picks a
 * model for the cognitive tier, enforces a token budget, retries transient
 * failures, degrades to another provider rather than stalling the world, and
 * keeps a running tally of what the whole thing is costing you.
 *
 * Because provider is per-agent, one world can contain Claude agents, GPT
 * agents and Grok agents living in the same city and arguing with each other.
 */

import type { MindFn, MindRequest, MindResponse } from '@epoch/core';
import type { Provider, ProviderResult, Tier, Usage } from './types.ts';
import { ProviderError } from './types.ts';
import { getProvider, resolveProvider } from './registry.ts';
import { costUSD } from './pricing.ts';
import { parseJson } from './json.ts';

/** Token budgets per tier. Generous, because thinking counts against them. */
const MAX_TOKENS: Record<Tier, number> = {
  fast: 2048,
  standard: 4096,
  deep: 8192,
};

export interface MindStats {
  calls: number;
  failures: number;
  retries: number;
  fallbacks: number;
  parseFailures: number;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  /** Per-provider breakdown, for the UI's cost panel. */
  byProvider: Record<string, { calls: number; inputTokens: number; outputTokens: number; costUSD: number }>;
}

export interface MindOptions {
  /** Attempts per provider before giving up on it. */
  maxAttempts?: number;
  /** Milliseconds before a single call is abandoned. */
  timeoutMs?: number;
  /**
   * When a provider fails outright, try the next configured one. Keeps a long
   * run alive through a rate limit or an outage. Set false to fail loudly.
   */
  allowFallback?: boolean;
  /** Cache identical prompts within a run. Cheap insurance against loops. */
  cache?: boolean;
  onWarning?: (message: string, detail?: unknown) => void;
  /** Called after every successful call — used to stream cost to the UI. */
  onUsage?: (usage: Usage & { provider: string; model: string; kind: string }) => void;
}

export interface Mind {
  /** Pass this to `new Simulation({ mind })`. */
  fn: MindFn;
  stats: MindStats;
  reset(): void;
}

/**
 * How many prompts the response cache remembers.
 *
 * This has to be bounded and it has to be small. A situation report is several
 * kilobytes and every agent-hour produces a new one, so an unbounded cache
 * keyed on the prompt text will exhaust the heap in minutes on a fast run —
 * which is exactly what it did before this cap existed. Keys are hashed rather
 * than stored, so the cache holds no prompt text at all.
 */
const CACHE_LIMIT = 256;

export function createMind(options: MindOptions = {}): Mind {
  const maxAttempts = options.maxAttempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const allowFallback = options.allowFallback ?? true;
  const warn = options.onWarning ?? (() => {});
  const cache = options.cache === false ? null : new Map<string, unknown>();

  const stats: MindStats = emptyStats();

  const remember = (key: string, value: unknown) => {
    if (!cache) return;
    // Map preserves insertion order, so the first key is the oldest.
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, value);
  };

  const fn: MindFn = async <T,>(request: MindRequest): Promise<MindResponse<T>> => {
    const cacheKey = cache
      ? `${request.mind.provider}|${request.tier}|${hash(request.system)}|${hash(request.user)}`
      : null;
    if (cacheKey && cache!.has(cacheKey)) {
      return { data: cache!.get(cacheKey) as T, usage: { inputTokens: 0, outputTokens: 0, costUSD: 0 } };
    }

    const primary = resolveProvider(request.mind.provider);
    const chain = allowFallback ? fallbackChain(primary) : [primary];

    let lastError: unknown;

    for (const provider of chain) {
      if (provider !== primary) {
        stats.fallbacks++;
        warn(`${primary.id} unavailable — falling back to ${provider.id}`, lastError);
      }

      try {
        const result = await callWithRetry(provider, request, { maxAttempts, timeoutMs, stats, warn });
        const parsed = parseJson<T>(result.text);

        if (!parsed.ok) {
          stats.parseFailures++;
          throw new ProviderError(
            `${provider.id} returned something that is not JSON: ${result.text.slice(0, 160)}`,
            provider.id,
            undefined,
            true,
          );
        }

        const usage = record(stats, provider.id, result);
        options.onUsage?.({ ...usage, provider: provider.id, model: result.model, kind: request.kind });
        if (cacheKey) remember(cacheKey, parsed.data);

        return { data: parsed.data as T, usage, model: result.model, provider: provider.id };
      } catch (error) {
        lastError = error;
      }
    }

    stats.failures++;
    throw lastError instanceof Error
      ? lastError
      : new Error(`No provider could answer for agent ${request.agentId}.`);
  };

  return {
    fn,
    stats,
    reset() {
      Object.assign(stats, emptyStats());
      cache?.clear();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

async function callWithRetry(
  provider: Provider,
  request: MindRequest,
  ctx: {
    maxAttempts: number;
    timeoutMs: number;
    stats: MindStats;
    warn: (message: string, detail?: unknown) => void;
  },
): Promise<ProviderResult> {
  const model = request.mind.model ?? provider.modelFor(request.tier);
  let lastError: unknown;

  for (let attempt = 1; attempt <= ctx.maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);

    try {
      return await provider.complete({
        model,
        system: request.system,
        user: request.user,
        schema: request.schema,
        schemaName: `epoch_${request.kind}`,
        maxTokens: MAX_TOKENS[request.tier],
        tier: request.tier,
        temperature: request.mind.temperature,
        signal: controller.signal,
      });
    } catch (error) {
      lastError = error;
      const retryable = !(error instanceof ProviderError) || error.retryable;
      if (!retryable || attempt === ctx.maxAttempts) break;

      ctx.stats.retries++;
      // Exponential backoff with jitter, so a rate-limited world doesn't
      // reconverge on the same instant and get limited all over again.
      const delay = Math.min(20_000, 2 ** attempt * 400) * (0.7 + Math.random() * 0.6);
      ctx.warn(`${provider.id} attempt ${attempt} failed, retrying in ${Math.round(delay)}ms`, error);
      await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

/** The provider, then every other configured one, then the mock as a floor. */
function fallbackChain(primary: Provider): Provider[] {
  const chain: Provider[] = [primary];
  for (const id of ['anthropic', 'openai', 'xai', 'google', 'groq', 'openrouter', 'ollama']) {
    const provider = getProvider(id);
    if (provider && provider.isConfigured() && provider.id !== primary.id) chain.push(provider);
  }
  const mock = getProvider('mock');
  if (mock && primary.id !== 'mock') chain.push(mock);
  return chain;
}

function record(stats: MindStats, providerId: string, result: ProviderResult): Usage {
  const cost = costUSD(providerId, result.model, result.inputTokens, result.outputTokens);

  stats.calls++;
  stats.inputTokens += result.inputTokens;
  stats.outputTokens += result.outputTokens;
  stats.costUSD += cost;

  const bucket = (stats.byProvider[providerId] ??= {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUSD: 0,
  });
  bucket.calls++;
  bucket.inputTokens += result.inputTokens;
  bucket.outputTokens += result.outputTokens;
  bucket.costUSD += cost;

  return { inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUSD: cost };
}

function emptyStats(): MindStats {
  return {
    calls: 0,
    failures: 0,
    retries: 0,
    fallbacks: 0,
    parseFailures: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUSD: 0,
    byProvider: {},
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** FNV-1a. Used so the cache holds fixed-size keys instead of whole prompts. */
function hash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

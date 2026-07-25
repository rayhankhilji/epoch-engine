/**
 * Price table for the cost meter.
 *
 * Prices are USD per million tokens and are a best-effort snapshot — providers
 * change them. `EPOCH_PRICE_<PROVIDER>_<MODEL>=in/out` overrides any entry at
 * runtime, and an unknown model falls back to its provider's default rather
 * than silently costing nothing.
 */

import type { Price } from './types.ts';

const TABLE: Record<string, Record<string, Price>> = {
  anthropic: {
    'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
    'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
    'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15 },
    'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
    'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
    'claude-fable-5': { inputPerMTok: 10, outputPerMTok: 50 },
  },
  openai: {
    'gpt-5': { inputPerMTok: 1.25, outputPerMTok: 10 },
    'gpt-5-mini': { inputPerMTok: 0.25, outputPerMTok: 2 },
    'gpt-5-nano': { inputPerMTok: 0.05, outputPerMTok: 0.4 },
    'gpt-4.1': { inputPerMTok: 2, outputPerMTok: 8 },
    'gpt-4.1-mini': { inputPerMTok: 0.4, outputPerMTok: 1.6 },
    'gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10 },
    'gpt-4o-mini': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  },
  xai: {
    'grok-4': { inputPerMTok: 3, outputPerMTok: 15 },
    'grok-4-fast': { inputPerMTok: 0.2, outputPerMTok: 0.5 },
    'grok-3': { inputPerMTok: 3, outputPerMTok: 15 },
    'grok-3-mini': { inputPerMTok: 0.3, outputPerMTok: 0.5 },
  },
  google: {
    'gemini-2.5-pro': { inputPerMTok: 1.25, outputPerMTok: 10 },
    'gemini-2.5-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
    'gemini-2.5-flash-lite': { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  },
  groq: {
    'llama-3.3-70b-versatile': { inputPerMTok: 0.59, outputPerMTok: 0.79 },
    'llama-3.1-8b-instant': { inputPerMTok: 0.05, outputPerMTok: 0.08 },
  },
  openrouter: {},
  ollama: {},
  mock: {},
};

/** Used when a provider reports a model we have no price for. */
const PROVIDER_FALLBACK: Record<string, Price> = {
  anthropic: { inputPerMTok: 3, outputPerMTok: 15 },
  openai: { inputPerMTok: 1.25, outputPerMTok: 10 },
  xai: { inputPerMTok: 3, outputPerMTok: 15 },
  google: { inputPerMTok: 1.25, outputPerMTok: 10 },
  groq: { inputPerMTok: 0.6, outputPerMTok: 0.8 },
  openrouter: { inputPerMTok: 1, outputPerMTok: 5 },
  ollama: { inputPerMTok: 0, outputPerMTok: 0 },
  mock: { inputPerMTok: 0, outputPerMTok: 0 },
};

export function priceFor(provider: string, model: string): Price {
  const override = readOverride(provider, model);
  if (override) return override;
  return TABLE[provider]?.[model] ?? PROVIDER_FALLBACK[provider] ?? { inputPerMTok: 0, outputPerMTok: 0 };
}

export function costUSD(provider: string, model: string, inputTokens: number, outputTokens: number): number {
  const price = priceFor(provider, model);
  return (inputTokens / 1e6) * price.inputPerMTok + (outputTokens / 1e6) * price.outputPerMTok;
}

/** EPOCH_PRICE_ANTHROPIC_CLAUDE_OPUS_5="5/25" */
function readOverride(provider: string, model: string): Price | undefined {
  const key = `EPOCH_PRICE_${provider}_${model}`.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const raw = process.env[key];
  if (!raw) return undefined;
  const [input, output] = raw.split('/').map(Number);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return undefined;
  return { inputPerMTok: input!, outputPerMTok: output! };
}

export function formatUSD(amount: number): string {
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

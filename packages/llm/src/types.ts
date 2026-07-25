/**
 * The provider contract.
 *
 * Every provider — Anthropic, OpenAI, xAI, Google, Groq, OpenRouter, Ollama —
 * reduces to the same thing: given a system prompt, a user prompt and a JSON
 * Schema, return an object that satisfies the schema, plus what it cost.
 */

export type Tier = 'fast' | 'standard' | 'deep';

export interface ProviderCall {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  /** Name given to the schema by providers that require one. */
  schemaName: string;
  maxTokens: number;
  tier: Tier;
  temperature?: number;
  signal?: AbortSignal;
}

export interface ProviderResult {
  /** Raw text the model produced, before JSON parsing. */
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from a provider-side cache, when reported. */
  cachedInputTokens?: number;
  model: string;
}

export interface Provider {
  /** Stable id used in scenarios and env vars, e.g. "anthropic". */
  readonly id: string;
  readonly label: string;
  /** Where to get a key. Shown when a scenario asks for a provider you have no key for. */
  readonly keysUrl?: string;
  /** True when the necessary key (or local server) is configured. */
  isConfigured(): boolean;
  /** Default model for a tier, before any scenario or env override. */
  modelFor(tier: Tier): string;
  complete(call: ProviderCall): Promise<ProviderResult>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
}

/** Per-million-token prices, used for the running cost meter. */
export interface Price {
  inputPerMTok: number;
  outputPerMTok: number;
}

export class ProviderError extends Error {
  readonly provider: string;
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(message: string, provider: string, status?: number, retryable = false) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.retryable = retryable;
  }
}

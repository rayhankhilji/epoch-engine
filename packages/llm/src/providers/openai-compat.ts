/**
 * Every OpenAI-compatible provider.
 *
 * OpenAI, xAI (Grok), Google Gemini, Groq, OpenRouter and a local Ollama server
 * all speak the same chat-completions dialect, so one implementation covers
 * them — the differences are a base URL, an env var, and how much of the
 * structured-output spec each one actually supports.
 */

import OpenAI from 'openai';
import type { Provider, ProviderCall, ProviderResult, Tier } from '../types.ts';
import { ProviderError } from '../types.ts';
import { describeSchema, strictify } from '../json.ts';

export interface CompatConfig {
  id: string;
  label: string;
  /** Env var holding the key. Omitted for providers that need none (Ollama). */
  envKey?: string;
  /** Env var that can override the base URL. */
  envBaseUrl?: string;
  baseURL?: string;
  keysUrl?: string;
  models: Record<Tier, string>;
  /**
   * `schema`  — full json_schema response format (best)
   * `object`  — json_object mode, schema described in the prompt
   * `prompt`  — no native mode at all
   */
  jsonMode: 'schema' | 'object' | 'prompt';
  /** OpenAI's newer models want `max_completion_tokens`. */
  tokenParam?: 'max_tokens' | 'max_completion_tokens';
  /** Models that reject a temperature. */
  noSampling?: RegExp;
}

export const COMPAT_PROVIDERS: CompatConfig[] = [
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    envKey: 'OPENAI_API_KEY',
    keysUrl: 'https://platform.openai.com/api-keys',
    models: { fast: 'gpt-5-nano', standard: 'gpt-5-mini', deep: 'gpt-5' },
    jsonMode: 'schema',
    tokenParam: 'max_completion_tokens',
    noSampling: /^(gpt-5|o[1-9])/,
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    envKey: 'XAI_API_KEY',
    baseURL: 'https://api.x.ai/v1',
    keysUrl: 'https://console.x.ai',
    models: { fast: 'grok-4-fast', standard: 'grok-4-fast', deep: 'grok-4' },
    jsonMode: 'schema',
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    envKey: 'GOOGLE_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    keysUrl: 'https://aistudio.google.com/apikey',
    models: { fast: 'gemini-2.5-flash-lite', standard: 'gemini-2.5-flash', deep: 'gemini-2.5-pro' },
    jsonMode: 'schema',
  },
  {
    id: 'groq',
    label: 'Groq',
    envKey: 'GROQ_API_KEY',
    baseURL: 'https://api.groq.com/openai/v1',
    keysUrl: 'https://console.groq.com/keys',
    models: {
      fast: 'llama-3.1-8b-instant',
      standard: 'llama-3.3-70b-versatile',
      deep: 'llama-3.3-70b-versatile',
    },
    jsonMode: 'object',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    baseURL: 'https://openrouter.ai/api/v1',
    keysUrl: 'https://openrouter.ai/keys',
    models: {
      fast: 'anthropic/claude-haiku-4.5',
      standard: 'anthropic/claude-sonnet-4.5',
      deep: 'anthropic/claude-opus-4.1',
    },
    jsonMode: 'object',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    envBaseUrl: 'OLLAMA_BASE_URL',
    baseURL: 'http://127.0.0.1:11434/v1',
    keysUrl: 'https://ollama.com',
    models: { fast: 'llama3.2', standard: 'llama3.1', deep: 'llama3.1:70b' },
    jsonMode: 'object',
  },
];

export function createCompatProvider(config: CompatConfig): Provider {
  let client: OpenAI | null = null;

  const baseURL = (): string | undefined => {
    const override = config.envBaseUrl ? process.env[config.envBaseUrl] : undefined;
    if (!override) return config.baseURL;
    // Accept a bare Ollama host and append the OpenAI-compatible path.
    return override.endsWith('/v1') || override.endsWith('/v1/') ? override : `${override.replace(/\/$/, '')}/v1`;
  };

  const ensureClient = (): OpenAI => {
    if (client) return client;
    const apiKey = config.envKey ? process.env[config.envKey] : 'not-needed';
    if (config.envKey && !apiKey) {
      throw new ProviderError(`${config.envKey} is not set.`, config.id, undefined, false);
    }
    client = new OpenAI({ apiKey: apiKey ?? 'not-needed', baseURL: baseURL(), maxRetries: 0 });
    return client;
  };

  return {
    id: config.id,
    label: config.label,
    keysUrl: config.keysUrl,

    isConfigured: () => (config.envKey ? Boolean(process.env[config.envKey]) : true),

    modelFor: (tier) =>
      process.env[`EPOCH_MODEL_${config.id.toUpperCase()}_${tier.toUpperCase()}`] ?? config.models[tier],

    async complete(call: ProviderCall): Promise<ProviderResult> {
      const openai = ensureClient();

      // Providers without a schema mode get the schema in the system prompt.
      const system =
        config.jsonMode === 'schema'
          ? call.system
          : `${call.system}\n\nRespond with a single JSON object and nothing else. It must satisfy this JSON Schema:\n${describeSchema(call.schema)}`;

      const tokenParam = config.tokenParam ?? 'max_tokens';
      const allowsSampling = !config.noSampling?.test(call.model);

      const params = {
        model: call.model,
        messages: [
          { role: 'system' as const, content: system },
          { role: 'user' as const, content: call.user },
        ],
        [tokenParam]: call.maxTokens,
        ...(config.jsonMode === 'schema'
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: call.schemaName,
                  strict: true,
                  schema: strictify(call.schema),
                },
              },
            }
          : config.jsonMode === 'object'
            ? { response_format: { type: 'json_object' } }
            : {}),
        ...(call.temperature != null && allowsSampling ? { temperature: call.temperature } : {}),
      } as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

      let completion: OpenAI.Chat.Completions.ChatCompletion;
      try {
        completion = await openai.chat.completions.create(params, { signal: call.signal });
      } catch (error) {
        throw wrapError(error, config.id);
      }

      const text = completion.choices[0]?.message?.content ?? '';
      const usage = completion.usage;

      return {
        text,
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
        model: completion.model ?? call.model,
      };
    },
  };
}

function wrapError(error: unknown, providerId: string): ProviderError {
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    const retryable = status === 429 || status === 408 || status === 409 || (status ?? 0) >= 500;
    return new ProviderError(`${status ?? '?'}: ${error.message}`, providerId, status, retryable);
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new ProviderError(error.message, providerId, undefined, true);
  }
  return new ProviderError(error instanceof Error ? error.message : String(error), providerId, undefined, true);
}

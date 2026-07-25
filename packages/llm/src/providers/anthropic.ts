/**
 * Anthropic (Claude).
 *
 * Uses the official `@anthropic-ai/sdk` and the Messages API's native
 * structured-output support, so the agent's decision comes back already
 * conforming to the schema `@epoch/core` asked for.
 *
 * Note on thinking: Claude Opus 5 thinks by default and `max_tokens` caps
 * thinking *plus* the response, so the budgets below are deliberately generous
 * for what is a small JSON object. Depth is steered with `effort` rather than
 * by disabling thinking, which avoids the failure modes that come with turning
 * it off.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Provider, ProviderCall, ProviderResult, Tier } from '../types.ts';
import { ProviderError } from '../types.ts';

const DEFAULT_MODELS: Record<Tier, string> = {
  fast: 'claude-haiku-4-5',
  standard: 'claude-sonnet-5',
  deep: 'claude-opus-5',
};

const EFFORT: Record<Tier, 'low' | 'medium' | 'high'> = {
  fast: 'low',
  standard: 'medium',
  deep: 'high',
};

/** Models that reject `temperature` outright. */
const NO_SAMPLING = /^claude-(opus-5|opus-4-8|opus-4-7|sonnet-5|fable-5|mythos-5)/;

export function createAnthropicProvider(): Provider {
  let client: Anthropic | null = null;

  const ensureClient = (): Anthropic => {
    if (client) return client;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ProviderError('ANTHROPIC_API_KEY is not set.', 'anthropic', undefined, false);
    }
    client = new Anthropic({ apiKey, maxRetries: 0 });
    return client;
  };

  return {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    keysUrl: 'https://console.anthropic.com/settings/keys',

    isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),

    modelFor: (tier) => process.env[`EPOCH_MODEL_ANTHROPIC_${tier.toUpperCase()}`] ?? DEFAULT_MODELS[tier],

    async complete(call: ProviderCall): Promise<ProviderResult> {
      const anthropic = ensureClient();

      // `output_config` carries both the effort hint and the response schema.
      // Cast because its typing varies across SDK minor versions.
      const params = {
        model: call.model,
        max_tokens: call.maxTokens,
        system: call.system,
        messages: [{ role: 'user' as const, content: call.user }],
        output_config: {
          effort: EFFORT[call.tier],
          format: {
            type: 'json_schema',
            schema: call.schema,
          },
        },
        ...(call.temperature != null && !NO_SAMPLING.test(call.model)
          ? { temperature: call.temperature }
          : {}),
      } as unknown as Anthropic.MessageCreateParamsNonStreaming;

      let message: Anthropic.Message;
      try {
        message = await anthropic.messages.create(params, { signal: call.signal });
      } catch (error) {
        throw wrapError(error);
      }

      // Safety classifiers can decline a request; that arrives as a successful
      // 200 with an empty content array, not as an error. `stop_details` is
      // only populated on a refusal and is untyped in some SDK versions.
      if (message.stop_reason === 'refusal') {
        const details = (message as { stop_details?: { category?: string | null } }).stop_details;
        const category = details?.category ? ` (${details.category})` : '';
        throw new ProviderError(`Claude declined this request${category}.`, 'anthropic', undefined, false);
      }

      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      return {
        text,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cachedInputTokens: message.usage.cache_read_input_tokens ?? 0,
        model: message.model,
      };
    },
  };
}

function wrapError(error: unknown): ProviderError {
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    const retryable = status === 429 || status === 408 || status === 409 || (status ?? 0) >= 500;
    return new ProviderError(`${status ?? '?'}: ${error.message}`, 'anthropic', status, retryable);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError(error.message, 'anthropic', undefined, true);
  }
  return new ProviderError(error instanceof Error ? error.message : String(error), 'anthropic', undefined, true);
}

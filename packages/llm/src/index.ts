/**
 * @epoch/llm — bring your own keys.
 *
 * Every agent in Epoch thinks through a real language model. Which one is up to
 * you, and it is set per agent, so a single world can be a genuinely mixed
 * society of Claude, GPT, Grok, Gemini and locally-hosted minds.
 */

export * from './types.ts';
export * from './pricing.ts';
export * from './json.ts';
export * from './registry.ts';
export * from './router.ts';
export { COMPAT_PROVIDERS } from './providers/openai-compat.ts';
export { createMockProvider } from './providers/mock.ts';
export { createAnthropicProvider } from './providers/anthropic.ts';

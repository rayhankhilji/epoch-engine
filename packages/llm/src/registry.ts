/**
 * The provider registry.
 *
 * Keys are read from the environment and never written anywhere — this is the
 * whole of the BYOK story. Nothing in Epoch persists, logs or transmits a key,
 * and a provider you have no key for simply reports itself unconfigured.
 */

import type { Provider, Tier } from './types.ts';
import { createAnthropicProvider } from './providers/anthropic.ts';
import { COMPAT_PROVIDERS, createCompatProvider } from './providers/openai-compat.ts';
import { createMockProvider } from './providers/mock.ts';

/**
 * Order used when a scenario says `provider: "auto"`. Ollama sits above mock
 * because a local model is still a real model.
 */
export const PREFERENCE: string[] = [
  'anthropic',
  'openai',
  'xai',
  'google',
  'groq',
  'openrouter',
  'ollama',
  'mock',
];

let registry: Map<string, Provider> | null = null;

export function providers(): Map<string, Provider> {
  if (registry) return registry;

  registry = new Map<string, Provider>();
  registry.set('anthropic', createAnthropicProvider());
  for (const config of COMPAT_PROVIDERS) {
    registry.set(config.id, createCompatProvider(config));
  }
  registry.set('mock', createMockProvider());
  return registry;
}

/** Re-read the environment. Used by tests that mutate `process.env`. */
export function resetProviders(): void {
  registry = null;
}

export function getProvider(id: string): Provider | undefined {
  return providers().get(id);
}

/** Every provider that has a usable key (or needs none), in preference order. */
export function configuredProviders(): Provider[] {
  const all = providers();
  return PREFERENCE.map((id) => all.get(id)).filter(
    (provider): provider is Provider => provider != null && provider.isConfigured(),
  );
}

/** True when nothing but the mock is available. */
export function isKeyless(): boolean {
  return configuredProviders().every((provider) => provider.id === 'mock');
}

/**
 * Resolve a provider id, expanding `auto` to the best configured option.
 * Unknown or unconfigured providers fall back rather than throwing, so a
 * scenario that mentions Grok still runs for someone who only has a Claude key.
 */
export function resolveProvider(requested: string | undefined): Provider {
  const all = providers();

  if (requested && requested !== 'auto') {
    const provider = all.get(requested);
    if (provider?.isConfigured()) return provider;
  }

  const configured = configuredProviders();
  return configured[0] ?? all.get('mock')!;
}

export function modelFor(provider: Provider, tier: Tier, override?: string): string {
  return override ?? provider.modelFor(tier);
}

export interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  keysUrl?: string;
  models: Record<Tier, string>;
}

/** Everything the CLI and the UI need to show a "which minds are available" panel. */
export function providerStatus(): ProviderStatus[] {
  return PREFERENCE.map((id) => {
    const provider = providers().get(id)!;
    return {
      id: provider.id,
      label: provider.label,
      configured: provider.isConfigured(),
      keysUrl: provider.keysUrl,
      models: {
        fast: provider.modelFor('fast'),
        standard: provider.modelFor('standard'),
        deep: provider.modelFor('deep'),
      },
    };
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseJson, strictify, describeSchema } from '../src/json.ts';
import { costUSD, priceFor, formatUSD } from '../src/pricing.ts';
import { createMockProvider } from '../src/providers/mock.ts';
import {
  configuredProviders,
  getProvider,
  isKeyless,
  providerStatus,
  providers,
  resetProviders,
  resolveProvider,
} from '../src/registry.ts';
import { createMind } from '../src/router.ts';
import type { MindRequest } from '@epoch/core';

// ─────────────────────────────────────────────────────────────────────────────
// JSON recovery
// ─────────────────────────────────────────────────────────────────────────────

test('clean JSON parses directly', () => {
  const result = parseJson<{ a: number }>('{"a": 1}');
  assert.equal(result.ok, true);
  assert.equal(result.via, 'direct');
  assert.equal(result.data!.a, 1);
});

test('JSON wrapped in a code fence is recovered', () => {
  const result = parseJson<{ action: string }>('```json\n{"action": "work"}\n```');
  assert.equal(result.ok, true);
  assert.equal(result.data!.action, 'work');
});

test('JSON buried in prose is recovered', () => {
  const result = parseJson<{ action: string }>('Sure! Here is my decision:\n{"action": "rest"}\nHope that helps.');
  assert.equal(result.ok, true);
  assert.equal(result.data!.action, 'rest');
});

test('a trailing comma is repaired', () => {
  const result = parseJson<{ a: number }>('{"a": 1,}');
  assert.equal(result.ok, true);
  assert.equal(result.data!.a, 1);
});

test('a truncated response is closed and recovered', () => {
  const result = parseJson<{ action: string; args: Record<string, unknown> }>(
    '{"action": "work", "args": {"focus": "the deck"',
  );
  assert.equal(result.ok, true);
  assert.equal(result.data!.action, 'work');
});

test('braces inside strings do not confuse the extractor', () => {
  const result = parseJson<{ reasoning: string }>('{"reasoning": "I said {this} and then left"}');
  assert.equal(result.ok, true);
  assert.equal(result.data!.reasoning, 'I said {this} and then left');
});

test('genuinely unparseable text fails cleanly rather than throwing', () => {
  const result = parseJson('I would rather not answer that.');
  assert.equal(result.ok, false);
  assert.equal(result.data, null);
});

test('strictify marks every property required and forbids extras', () => {
  const strict = strictify({
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'number' } },
    required: ['a'],
  }) as { required: string[]; additionalProperties: boolean };

  assert.deepEqual(strict.required, ['a', 'b']);
  assert.equal(strict.additionalProperties, false);
});

test('strictify recurses into nested objects and arrays', () => {
  const strict = strictify({
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: { type: 'object', properties: { x: { type: 'string' }, y: { type: 'string' } }, required: ['x'] },
      },
    },
    required: [],
  }) as never as { properties: { items: { items: { required: string[] } } } };

  assert.deepEqual(strict.properties.items.items.required, ['x', 'y']);
});

test('describeSchema produces readable JSON for prompt embedding', () => {
  assert.ok(describeSchema({ type: 'object' }).includes('"type"'));
});

// ─────────────────────────────────────────────────────────────────────────────
// Pricing
// ─────────────────────────────────────────────────────────────────────────────

test('known models are priced from the table', () => {
  const price = priceFor('anthropic', 'claude-opus-5');
  assert.equal(price.inputPerMTok, 5);
  assert.equal(price.outputPerMTok, 25);
  assert.equal(costUSD('anthropic', 'claude-opus-5', 1_000_000, 1_000_000), 30);
});

test('an unknown model falls back to its provider rather than costing nothing', () => {
  const cost = costUSD('anthropic', 'claude-something-unreleased', 1_000_000, 0);
  assert.ok(cost > 0, 'unknown Anthropic models should still be costed');
});

test('local models are free', () => {
  assert.equal(costUSD('ollama', 'llama3.1', 1_000_000, 1_000_000), 0);
});

test('prices can be overridden from the environment', () => {
  process.env.EPOCH_PRICE_OPENAI_GPT_5 = '2/8';
  try {
    assert.equal(priceFor('openai', 'gpt-5').inputPerMTok, 2);
  } finally {
    delete process.env.EPOCH_PRICE_OPENAI_GPT_5;
  }
});

test('costs format legibly at every magnitude', () => {
  assert.equal(formatUSD(0.0004), '$0.0004');
  assert.equal(formatUSD(0.5), '$0.500');
  assert.equal(formatUSD(12.3456), '$12.35');
});

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

test('every advertised provider is registered', () => {
  for (const id of ['anthropic', 'openai', 'xai', 'google', 'groq', 'openrouter', 'ollama', 'mock']) {
    assert.ok(providers().has(id), `${id} should be registered`);
  }
});

test('the mock provider is always available so the repo runs with no keys', () => {
  assert.equal(getProvider('mock')!.isConfigured(), true);
  assert.ok(configuredProviders().some((p) => p.id === 'mock'));
});

test('an unconfigured provider resolves to something usable instead of throwing', () => {
  const previous = process.env.XAI_API_KEY;
  delete process.env.XAI_API_KEY;
  resetProviders();
  try {
    const provider = resolveProvider('xai');
    assert.ok(provider.isConfigured(), 'resolution should never return an unusable provider');
  } finally {
    if (previous) process.env.XAI_API_KEY = previous;
    resetProviders();
  }
});

test('a configured provider is honoured', () => {
  process.env.XAI_API_KEY = 'test-key-not-real';
  resetProviders();
  try {
    assert.equal(resolveProvider('xai').id, 'xai');
  } finally {
    delete process.env.XAI_API_KEY;
    resetProviders();
  }
});

test('provider status reports models for every tier', () => {
  for (const status of providerStatus()) {
    assert.ok(status.models.fast.length > 0);
    assert.ok(status.models.standard.length > 0);
    assert.ok(status.models.deep.length > 0);
  }
});

test('model ids can be overridden from the environment', () => {
  process.env.EPOCH_MODEL_ANTHROPIC_DEEP = 'claude-sonnet-5';
  resetProviders();
  try {
    assert.equal(getProvider('anthropic')!.modelFor('deep'), 'claude-sonnet-5');
  } finally {
    delete process.env.EPOCH_MODEL_ANTHROPIC_DEEP;
    resetProviders();
  }
});

test('isKeyless reflects whether any real provider is configured', () => {
  assert.equal(typeof isKeyless(), 'boolean');
});

// ─────────────────────────────────────────────────────────────────────────────
// Mock provider
// ─────────────────────────────────────────────────────────────────────────────

const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'args', 'reasoning', 'expectedValue'],
  properties: {
    action: { type: 'string', enum: ['work', 'rest', 'socialise', 'apply_for_job', 'fundraise', 'study'] },
    args: { type: 'object', additionalProperties: true },
    reasoning: { type: 'string' },
    expectedValue: { type: 'number', minimum: 0, maximum: 1 },
    revisePlan: { type: 'boolean' },
  },
};

function call(user: string): MindRequest {
  return {
    agentId: 'agent_1',
    kind: 'act',
    mind: { provider: 'mock' },
    tier: 'fast',
    system: 'You are a person.',
    user,
    schema: DECISION_SCHEMA,
  };
}

test('the mock provider produces schema-valid output', async () => {
  const provider = createMockProvider();
  const result = await provider.complete({
    model: 'mock-1',
    system: 'You are a person.',
    user: 'An ordinary Tuesday.',
    schema: DECISION_SCHEMA,
    schemaName: 'decision',
    maxTokens: 512,
    tier: 'fast',
  });

  const parsed = parseJson<{ action: string; expectedValue: number; reasoning: string }>(result.text);
  assert.equal(parsed.ok, true);
  assert.ok(DECISION_SCHEMA.properties.action.enum.includes(parsed.data!.action));
  assert.ok(parsed.data!.expectedValue >= 0 && parsed.data!.expectedValue <= 1);
  assert.ok(parsed.data!.reasoning.length > 0);
});

test('the mock provider is deterministic for the same prompt', async () => {
  const provider = createMockProvider();
  const input = {
    model: 'mock-1',
    system: 'You are a person.',
    user: 'Identical prompt.',
    schema: DECISION_SCHEMA,
    schemaName: 'decision',
    maxTokens: 512,
    tier: 'fast' as const,
  };
  const a = await provider.complete(input);
  const b = await provider.complete(input);
  assert.equal(a.text, b.text);
});

test('the mock provider reads the situation rather than choosing at random', async () => {
  const provider = createMockProvider();
  const result = await provider.complete({
    model: 'mock-1',
    system: 'You are a person.',
    user: 'What is pressing on you: I am running out of money.',
    schema: DECISION_SCHEMA,
    schemaName: 'decision',
    maxTokens: 512,
    tier: 'fast',
  });
  const parsed = parseJson<{ action: string }>(result.text);
  assert.ok(['work', 'apply_for_job'].includes(parsed.data!.action), `got ${parsed.data!.action}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

test('the router returns parsed data and accounts for usage', async () => {
  const mind = createMind({ cache: false });
  const response = await mind.fn<{ action: string }>(call('An ordinary day.'));

  assert.ok(response.data.action);
  assert.equal(mind.stats.calls, 1);
  assert.ok(mind.stats.inputTokens > 0);
  assert.ok(mind.stats.byProvider['mock']);
});

test('identical prompts are served from cache without a second call', async () => {
  const mind = createMind({ cache: true });
  await mind.fn(call('Exactly the same prompt.'));
  await mind.fn(call('Exactly the same prompt.'));
  assert.equal(mind.stats.calls, 1, 'the second call should be a cache hit');
});

test('caching can be disabled', async () => {
  const mind = createMind({ cache: false });
  await mind.fn(call('Same prompt again.'));
  await mind.fn(call('Same prompt again.'));
  assert.equal(mind.stats.calls, 2);
});

test('reset clears stats and cache', async () => {
  const mind = createMind({ cache: true });
  await mind.fn(call('Something.'));
  mind.reset();
  assert.equal(mind.stats.calls, 0);
  assert.deepEqual(mind.stats.byProvider, {});
});

test('a failing provider falls back rather than stalling the world', async () => {
  const registry = providers();
  const original = registry.get('mock')!;
  const warnings: string[] = [];

  registry.set('broken', {
    id: 'broken',
    label: 'Broken',
    isConfigured: () => true,
    modelFor: () => 'broken-1',
    async complete() {
      throw new Error('provider is on fire');
    },
  });

  try {
    const mind = createMind({ cache: false, maxAttempts: 1, onWarning: (m) => warnings.push(m) });
    const response = await mind.fn<{ action: string }>({ ...call('A day.'), mind: { provider: 'broken' } });

    assert.ok(response.data.action, 'the fallback produced a usable decision');
    assert.equal(response.provider, 'mock');
    assert.equal(mind.stats.fallbacks > 0, true);
    assert.ok(warnings.some((w) => w.includes('broken')));
  } finally {
    registry.delete('broken');
    registry.set('mock', original);
  }
});

test('fallback can be disabled so failures surface', async () => {
  const registry = providers();
  registry.set('broken2', {
    id: 'broken2',
    label: 'Broken',
    isConfigured: () => true,
    modelFor: () => 'broken-1',
    async complete() {
      throw new Error('provider is on fire');
    },
  });

  try {
    const mind = createMind({ cache: false, maxAttempts: 1, allowFallback: false });
    await assert.rejects(() => mind.fn({ ...call('A day.'), mind: { provider: 'broken2' } }));
    assert.equal(mind.stats.failures, 1);
  } finally {
    registry.delete('broken2');
  }
});

test('a transient failure is retried and then succeeds', async () => {
  const registry = providers();
  let attempts = 0;

  registry.set('flaky', {
    id: 'flaky',
    label: 'Flaky',
    isConfigured: () => true,
    modelFor: () => 'flaky-1',
    async complete() {
      attempts++;
      if (attempts < 2) throw new Error('rate limited');
      return { text: '{"action":"work","args":{},"reasoning":"ok","expectedValue":0.5}', inputTokens: 10, outputTokens: 5, model: 'flaky-1' };
    },
  });

  try {
    const mind = createMind({ cache: false, maxAttempts: 3 });
    const response = await mind.fn<{ action: string }>({ ...call('A day.'), mind: { provider: 'flaky' } });
    assert.equal(response.data.action, 'work');
    assert.equal(attempts, 2);
    assert.ok(mind.stats.retries > 0);
  } finally {
    registry.delete('flaky');
  }
});

test('non-JSON output is counted and recovered via fallback', async () => {
  const registry = providers();
  registry.set('chatty', {
    id: 'chatty',
    label: 'Chatty',
    isConfigured: () => true,
    modelFor: () => 'chatty-1',
    async complete() {
      return { text: 'I would rather talk about something else.', inputTokens: 5, outputTokens: 5, model: 'chatty-1' };
    },
  });

  try {
    const mind = createMind({ cache: false, maxAttempts: 1 });
    const response = await mind.fn<{ action: string }>({ ...call('A day.'), mind: { provider: 'chatty' } });
    assert.ok(mind.stats.parseFailures > 0);
    assert.ok(response.data.action, 'the world still got a decision');
  } finally {
    registry.delete('chatty');
  }
});

test('a per-agent model override is honoured', async () => {
  const registry = providers();
  let seenModel = '';

  registry.set('spy', {
    id: 'spy',
    label: 'Spy',
    isConfigured: () => true,
    modelFor: () => 'default-model',
    async complete(request) {
      seenModel = request.model;
      return { text: '{"action":"rest","args":{},"reasoning":"tired","expectedValue":0.4}', inputTokens: 1, outputTokens: 1, model: request.model };
    },
  });

  try {
    const mind = createMind({ cache: false });
    await mind.fn({ ...call('A day.'), mind: { provider: 'spy', model: 'a-specific-model' } });
    assert.equal(seenModel, 'a-specific-model');
  } finally {
    registry.delete('spy');
  }
});

test('different agents can use different providers in one world', async () => {
  const registry = providers();
  const seen: string[] = [];

  for (const id of ['alpha', 'beta']) {
    registry.set(id, {
      id,
      label: id,
      isConfigured: () => true,
      modelFor: () => `${id}-1`,
      async complete() {
        seen.push(id);
        return { text: '{"action":"work","args":{},"reasoning":"ok","expectedValue":0.5}', inputTokens: 1, outputTokens: 1, model: `${id}-1` };
      },
    });
  }

  try {
    const mind = createMind({ cache: false });
    await mind.fn({ ...call('Agent one.'), mind: { provider: 'alpha' } });
    await mind.fn({ ...call('Agent two.'), mind: { provider: 'beta' } });

    assert.deepEqual(seen, ['alpha', 'beta']);
    assert.ok(mind.stats.byProvider['alpha']);
    assert.ok(mind.stats.byProvider['beta']);
  } finally {
    registry.delete('alpha');
    registry.delete('beta');
  }
});

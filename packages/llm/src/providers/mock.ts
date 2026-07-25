/**
 * The mock mind.
 *
 * Epoch is LLM-first: every real decision is made by a real model. But a repo
 * that cannot run without an API key is a repo nobody tries, and a test suite
 * that needs one is a test suite nobody runs. So the mock provider satisfies
 * the same contract deterministically — it reads the situation report, picks a
 * defensible action from the cues in it, and fills in whatever schema it was
 * handed.
 *
 * It is not pretending to be intelligent. It exists so `npm start` works, so
 * CI is hermetic, and so you can watch the world's mechanics turn before
 * deciding which provider to point at it.
 */

import type { Provider, ProviderCall, ProviderResult } from '../types.ts';

export function createMockProvider(): Provider {
  return {
    id: 'mock',
    label: 'Mock (deterministic, no key)',

    isConfigured: () => true,

    modelFor: () => 'mock-1',

    async complete(call: ProviderCall): Promise<ProviderResult> {
      const seed = hash(`${call.system}\n${call.user}`);
      const value = synthesise(call.schema, call.user, seed);
      const text = JSON.stringify(value);
      return {
        text,
        inputTokens: Math.ceil((call.system.length + call.user.length) / 4),
        outputTokens: Math.ceil(text.length / 4),
        model: 'mock-1',
      };
    },
  };
}

/** Build a value satisfying `schema`, biased by whatever the prompt says. */
function synthesise(schema: Record<string, unknown>, prompt: string, seed: number): unknown {
  const rand = mulberry(seed);

  const build = (node: Record<string, unknown>, key: string): unknown => {
    if (Array.isArray(node.enum) && node.enum.length > 0) {
      return chooseEnum(node.enum as unknown[], prompt, key, rand);
    }

    switch (node.type) {
      case 'object': {
        const properties = (node.properties ?? {}) as Record<string, Record<string, unknown>>;
        const out: Record<string, unknown> = {};
        for (const [name, child] of Object.entries(properties)) {
          out[name] = build(child, name);
        }
        // Free-form arg bags carry no schema; give the action something usable.
        if (Object.keys(properties).length === 0 && key === 'args') return argsFor(prompt);
        return out;
      }
      case 'array': {
        const items = (node.items ?? { type: 'string' }) as Record<string, unknown>;
        const min = typeof node.minItems === 'number' ? node.minItems : 0;
        const max = typeof node.maxItems === 'number' ? Math.min(node.maxItems, min + 2) : min + 1;
        const count = min + Math.floor(rand() * Math.max(1, max - min + 1));
        return Array.from({ length: count }, () => build(items, key));
      }
      case 'number':
      case 'integer': {
        const min = typeof node.minimum === 'number' ? node.minimum : 0;
        const max = typeof node.maximum === 'number' ? node.maximum : 1;
        const value = min + rand() * (max - min);
        return node.type === 'integer' ? Math.round(value) : Number(value.toFixed(2));
      }
      case 'boolean':
        return rand() < 0.15;
      case 'string':
      default:
        return sentenceFor(key, prompt);
    }
  };

  return build(schema, 'root');
}

/**
 * Pick an enum value using the situation report. This is what makes a mock run
 * look like a society rather than noise: an agent told it is out of money
 * looks for work, an exhausted one rests.
 */
function chooseEnum(options: unknown[], prompt: string, key: string, rand: () => number): unknown {
  const strings = options.filter((o): o is string => typeof o === 'string');
  if (strings.length === 0) return options[0];

  const lower = prompt.toLowerCase();
  const cues: Array<[RegExp, string[]]> = [
    [/running out of money|cannot cover this month|emergency debt/, ['work', 'apply_for_job', 'sell_asset']],
    [/i have no job/, ['apply_for_job', 'study', 'socialise']],
    [/nearly out of runway/, ['fundraise', 'work']],
    [/exhausted|energy 1?[0-9]%/, ['rest', 'exercise']],
    [/health is deteriorating/, ['seek_medical_care', 'rest']],
    [/serious stress/, ['rest', 'exercise', 'socialise']],
    [/i feel low/, ['socialise', 'exercise']],
    [/behind schedule/, ['work', 'study', 'research']],
    [/unicorn|billionaire|startup|found a company/, ['start_business', 'fundraise', 'work']],
    [/nobel|discover|research/, ['research', 'study', 'publish']],
  ];

  for (const [pattern, preferred] of cues) {
    if (!pattern.test(lower)) continue;
    const available = preferred.filter((p) => strings.includes(p));
    if (available.length > 0) return available[Math.floor(rand() * available.length)]!;
  }

  // Otherwise weight toward the ordinary business of being alive.
  const ordinary = ['work', 'rest', 'socialise', 'study', 'exercise'].filter((o) => strings.includes(o));
  const pool = ordinary.length > 0 && rand() < 0.85 ? ordinary : strings;
  void key;
  return pool[Math.floor(rand() * pool.length)]!;
}

function argsFor(prompt: string): Record<string, unknown> {
  const match = prompt.match(/\(id: (agent_[a-z0-9]+)\)/);
  return match ? { agentId: match[1] } : {};
}

function sentenceFor(key: string, prompt: string): string {
  switch (key) {
    case 'reasoning':
      return 'It is the most useful thing I can do with this hour.';
    case 'statement':
      return 'Effort compounds, and I have to keep showing up for it.';
    case 'topic':
      return 'self';
    case 'strategy':
      return 'Build steadily, keep costs low, and use the people I already know.';
    case 'summary':
      return 'An ordinary day, but I moved slightly forward.';
    case 'title': {
      const goal = prompt.match(/# The goal\n(.+)/)?.[1];
      return goal?.trim() ?? 'Keep making progress';
    }
    case 'op':
      return 'progress';
    case 'action':
      return 'work';
    default:
      return 'Steady progress.';
  }
}

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

# Providers — bring your own keys

Epoch never ships a key, never proxies your traffic, and never stores a key anywhere. Keys are read
from the environment at call time and go straight to the provider you chose.

## Setting up

```bash
cp .env.example .env
```

Add **one or more**. Any single one is enough to run everything.

| Provider | Env var | Get a key |
|---|---|---|
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | <https://console.anthropic.com/settings/keys> |
| OpenAI (GPT) | `OPENAI_API_KEY` | <https://platform.openai.com/api-keys> |
| xAI (Grok) | `XAI_API_KEY` | <https://console.x.ai> |
| Google (Gemini) | `GOOGLE_API_KEY` | <https://aistudio.google.com/apikey> |
| Groq | `GROQ_API_KEY` | <https://console.groq.com/keys> |
| OpenRouter | `OPENROUTER_API_KEY` | <https://openrouter.ai/keys> |
| Ollama | `OLLAMA_BASE_URL` | <https://ollama.com> — local, no key |
| Mock | — | always available, deterministic, free |

`.env` is gitignored. Variables already exported in your shell always win over the file, so a key in
your environment is never silently overridden by a stale file.

### Ollama is opt-in

Ollama counts as configured **only** once `OLLAMA_BASE_URL` is set. This is deliberate: a local server
that isn't running must never be auto-selected, or every decision in the world burns a failed
connection before falling back.

## Tiers

Each cognitive loop asks for a tier, and each provider maps tiers to models:

| Tier | Used by | Anthropic default | OpenAI default |
|---|---|---|---|
| `fast` | routine hourly decisions | `claude-haiku-4-5` | `gpt-5-nano` |
| `standard` | decisions the agent escalated as urgent | `claude-sonnet-5` | `gpt-5-mini` |
| `deep` | nightly reflection, and forming a plan | `claude-opus-5` | `gpt-5` |

Override any of them:

```bash
EPOCH_MODEL_ANTHROPIC_FAST=claude-sonnet-5
EPOCH_MODEL_OPENAI_DEEP=gpt-5
EPOCH_MODEL_XAI_STANDARD=grok-4
```

Or per agent, in a scenario:

```ts
agents: [
  { name: 'Ada Okonjo', cityId: 'city:san-francisco', mind: { provider: 'anthropic', model: 'claude-opus-5' } },
  { name: 'Tomas Vance', cityId: 'city:london', mind: { provider: 'openai' } },
]
```

## Mixing providers in one world

This is the interesting part. `minds` rotates across the background population:

```ts
minds: [
  { provider: 'anthropic' },
  { provider: 'openai' },
  { provider: 'xai' },
]
```

Agent 1 thinks with Claude, agent 2 with GPT, agent 3 with Grok, agent 4 with Claude again. They live
in the same cities, compete for the same jobs, and form opinions about each other. The console shows
which mind is behind each agent, and the cost meter breaks spend down by provider.

`{ provider: 'auto' }` resolves to the best configured provider at world creation, and the resolved
choice is pinned onto each agent so the UI can report it honestly.

## Structured output

Each provider gets the strongest guarantee it supports:

| Mode | Providers | How |
|---|---|---|
| `schema` | Anthropic, OpenAI, xAI, Google | Native JSON-schema-constrained output |
| `object` | Groq, OpenRouter, Ollama | JSON mode, with the schema described in the system prompt |
| `prompt` | fallback | Schema in the prompt only |

On Anthropic, depth is steered with `effort` rather than by disabling thinking, and `temperature` is
omitted on models that reject it.

Whatever comes back goes through a forgiving recovery pass — code fences, prose wrappers, smart quotes,
trailing commas, and responses truncated mid-object are all parsed rather than crashing an agent's turn.

## Resilience

- **Retries** — transient failures (429, 408, 5xx, connection errors) retry with exponential backoff and jitter, so a rate-limited world doesn't reconverge on the same instant and get limited all over again.
- **Fallback** — if a provider fails outright, the router tries the next configured one, then the mock as a floor. A long overnight run survives an outage. Set `allowFallback: false` to fail loudly instead.
- **Refusals** — a safety refusal is surfaced as a non-retryable error and falls through to the next provider rather than being retried.
- **Cache** — a 256-entry LRU keyed on hashed prompts, so a loop that asks the identical question twice only pays once. It stores no prompt text.

## Cost

The router tracks input and output tokens and prices them per provider and model:

```
Cognition
  1478 decisions · 1612 model calls · 3,151k in / 77k out · $2.84
  · anthropic     1204 calls  $2.61
  · xai            408 calls  $0.23
```

Prices are a best-effort snapshot and are overridable:

```bash
EPOCH_PRICE_ANTHROPIC_CLAUDE_OPUS_5="5/25"   # input/output USD per million tokens
```

An unknown model falls back to its provider's typical price rather than silently costing nothing.

## Running with no keys at all

The mock provider satisfies the same contract deterministically. It reads the situation report, picks a
defensible action from the cues in it, and fills in whatever schema it was handed.

It is not pretending to be intelligent. It exists so `npm run sim` works out of the box, so CI is
hermetic, and so you can watch the world's mechanics turn before deciding which provider to point at it.

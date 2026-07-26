# Contributing

Thanks for looking. Epoch is small, deliberately dependency-light, and easy to run.

## Getting set up

```bash
npm install
npm test          # 109 tests, hermetic — no network, no keys
npm run typecheck # strict TypeScript across every package
npm run sim -- --scenario exodus --days 3 --offline
```

You need Node ≥ 22.5 (for `node:sqlite` and native TypeScript). No API key is required for anything
above — the mock mind covers it.

## Where things live

```
packages/core     the engine. Zero dependencies, never opens a socket.
packages/llm      the BYOK router. The only place an SDK is imported.
packages/world    live reality. The only place `fetch` is called.
apps/server       runtime, persistence, HTTP + SSE API, CLI.
apps/web          the console. Talks to the API only; never imports the engine.
```

Those boundaries are load-bearing. In particular:

- **`@epoch/core` must stay dependency-free and offline.** It asks for thought through a `MindFn` and for reality through a `WorldDataSource`. That is what makes the whole engine testable without a network or a key, and deterministic from a seed.
- **`@epoch/web` must not import the engine.** It is a pure client of the HTTP API, which keeps the simulation out of the browser bundle and means the console would work just as well against a remote server.

## Tests

```bash
npm test
```

Tests must be **hermetic**. The world package stubs `globalThis.fetch` with recorded provider shapes;
please keep it that way, so CI never depends on nine third-party services staying up.

Determinism is a feature and is tested — if you touch generation, the seeded-population test should
still pass unchanged.

## Adding a provider

Most providers speak the OpenAI dialect, so adding one is usually a single entry in `COMPAT_PROVIDERS`
in [`openai-compat.ts`](packages/llm/src/providers/openai-compat.ts):

```ts
{
  id: 'yourprovider',
  label: 'Your Provider',
  envKey: 'YOURPROVIDER_API_KEY',
  baseURL: 'https://api.example.com/v1',
  keysUrl: 'https://example.com/keys',
  models: { fast: '…', standard: '…', deep: '…' },
  jsonMode: 'schema',   // or 'object' if it only has JSON mode
}
```

Then add it to `PREFERENCE` in `registry.ts`, prices in `pricing.ts`, and a line in `.env.example`.

If the provider has its own SDK and a materially better structured-output story, implement the
`Provider` interface directly — see [`anthropic.ts`](packages/llm/src/providers/anthropic.ts).

## Adding a live data source

It must be **free and keyless.** That constraint is the whole point of the world package: cloning the
repo and getting real weather and real market prices with no signup is a large part of what makes Epoch
worth trying.

Wrap it in `fetchJson`/`fetchText` so it inherits time-boxing, caching and retry, and route it through
`tolerate()` so a failure degrades to empty data and a warning rather than an exception. Then add it to
`SOURCES` in `index.ts` — that list is user-facing provenance, so it has to name the real provider.

## Adding an action

Actions live in [`actions.ts`](packages/core/src/actions.ts). Add a `ActionSpec` to `ACTION_CATALOG` and
a handler to `HANDLERS`.

The catalogue entry is shown to the model — it *is* the agent's understanding of its own affordances, so
write it in the second person and say what it costs.

A handler must:

- **Check preconditions and fail honestly.** An agent who cannot afford a flight does not take it. Return `ok: false` with a summary written in the agent's own voice.
- **Return a narrative summary.** It becomes both a memory and a timeline entry, so write it as the agent would recall it.
- **Set `importance` and `valence` carefully.** Importance drives what an agent remembers and what reaches the feed; valence drives mood and how the memory is coloured later.
- **Use `gain()` for positive stat changes.** Straight addition ratchets a stat to 1.0 and pins it there — a whole population at 99% mood is the tell.

## Style

- British spelling in prose and comments; the code follows whatever the surrounding file does.
- Comments explain **why**, not what. If a line's purpose is obvious, don't annotate it.
- No `any`. `noEmit` strict mode passes across every package.
- Prefer a small amount of arithmetic in the engine over another dependency.

## Reporting a bug

The most useful bug report includes the **seed and scenario**, because a world is reproducible from
them. `npm run sim -- --scenario X --seed N --days D --verbose` will reproduce it on our side exactly.

## License

By contributing you agree your work is MIT licensed, same as the rest of the project.

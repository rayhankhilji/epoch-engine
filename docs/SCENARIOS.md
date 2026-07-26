# Writing scenarios

A scenario states **who exists, where, and what they want.** It never states *how* — that is the entire
point of the project.

Scenarios live in [`apps/server/src/scenarios.ts`](../apps/server/src/scenarios.ts).

## The shape

```ts
{
  id: 'unicorn',
  name: 'The Unicorn',
  summary: 'Three founders in three cities are told to build a billion-dollar company. None of them know how.',
  description: 'San Francisco, London and Bengaluru. Three people with the same goal, wildly different starting capital…',

  seed: 1729,                    // determinism: same seed, same world
  cityIds: ['city:san-francisco', 'city:london', 'city:bangalore'],
  population: 24,                // background people, spread by city size
  minutesPerTick: 30,            // clock granularity
  maxConcurrentMinds: 6,         // ceiling on in-flight model calls
  callsPerSimDay: 60,            // used only for the cost estimate

  minds: [                       // rotated across the background population
    { provider: 'anthropic' },
    { provider: 'openai' },
    { provider: 'xai' },
  ],

  sharedGoals: [],               // given to everyone, in addition to their own

  agents: [                      // the named characters
    {
      name: 'Ada Okonjo',
      cityId: 'city:san-francisco',
      occupation: 'Founder',
      age: 27,
      goals: ['Build a company worth over $1 billion'],
      mind: { provider: 'anthropic', model: 'claude-opus-5' },
      overrides: {
        traits: { ambition: 0.95, riskTolerance: 0.88, discipline: 0.8,
                  creativity: 0.75, empathy: 0.5, charisma: 0.82, luck: 0.5 },
      },
    },
  ],
}
```

Everything except `id`, `name` and `summary` is optional.

## Writing a goal

Goals are given to the agent verbatim and shown in every situation report. Write them the way a person
would state their own ambition.

| Good | Why |
|---|---|
| `Build a company worth over $1 billion` | Concrete, checkable, no method implied |
| `Be the first to build artificial general intelligence` | Competitive — several agents can hold it |
| `Build a life I can actually afford` | Not about money maximisation; produces very different behaviour |
| `Be genuinely happy with my life` | Perfectly valid. The control group is interesting. |

| Avoid | Why |
|---|---|
| `Found a startup, raise a seed round, then a Series A` | That's a plan, not a goal — you've done the agent's job |
| `Maximise your net worth` | Reads as an objective function; you get an optimiser, not a person |

Goals attached to a named agent are **terminal**: the agent will not abandon one on a bad day, only
wear it down. `sharedGoals` are non-terminal and can be dropped.

## Shaping a character

`overrides` accepts any `Agent` field. The ones that change behaviour most:

```ts
overrides: {
  traits: { ambition: 0.95, riskTolerance: 0.88, discipline: 0.8, … },
  personality: { openness: 0.7, conscientiousness: 0.9, extraversion: 0.3,
                 agreeableness: 0.4, neuroticism: 0.2 },
  finances: { currency: 'USD', cash: 250_000, salary: 0, monthlyExpenses: 6_000,
              holdings: [], debts: [], ownership: [] },
  skills: { programming: 0.9, fundraising: 0.2 },
  values: ['freedom', 'legacy', 'excellence'],
}
```

Everything you don't override is generated coherently around what you did: a 24-year-old founder in
Lagos gets a plausible education, a plausible salary **in naira**, and plausible skills.

Two contrasts worth trying:

- **Same goal, different disposition.** One high-risk agent and one cautious one, same city, same goal. The cautious one usually survives longer and finishes smaller.
- **Same goal, different city.** Identical agents in San Francisco and Accra. Raising money is materially easier in one of them, and the scenario says so honestly.

## Cities

The bundled dataset has 40 real cities with real coordinates, timezones, cost-of-living indices, median
salaries and currencies — see [`data/cities.ts`](../packages/core/src/data/cities.ts). Omit `cityIds`
to use all of them.

For somewhere not in the set, `resolveCity()` in `@epoch/world` geocodes it live:

```ts
import { resolveCity } from '@epoch/world';
const manila = await resolveCity('Manila');
// real coordinates, real timezone, PHP, an estimated cost-of-living index
```

## Sizing a run

Cost scales with `agents × awake-hours`.

| Population | ~calls / sim-day | Good for |
|---|---|---|
| 1–5 | 10–20 | A single life, watched closely |
| 12–30 | 30–75 | Most interesting scenarios — enough for a society, cheap enough to run for a month |
| 200 | ~320 | Emergent macro behaviour. Start it, leave it, come back tomorrow. |

`minutesPerTick: 60` halves the cost of `30` and loses very little; agents still decide every simulated
hour, the clock just has fewer intermediate steps.

Put cheap models on the background population and an expensive one on the characters you care about —
that is what per-agent minds are for:

```ts
minds: [{ provider: 'groq' }],                                  // the crowd
agents: [{ name: 'Ada', mind: { provider: 'anthropic', model: 'claude-opus-5' } }],  // the protagonist
```

## Running one

```bash
npm run sim -- --scenario your-id --days 30
npm run sim -- --scenario your-id --days 30 --seed 42 --provider anthropic
npm run sim -- --scenario your-id --days 7 --offline --verbose
```

Or start it from the console, which shows a cost estimate before you commit.

## Determinism

Everything except the language model is reproducible from the seed. Same seed → same names, ages,
occupations, starting relationships and coincidences. Change the seed and you get a different world;
change the models and you get different lives in the same world.

That separation is the point: it lets you ask *what would this person have done with a different mind*
and get an answer that isn't confounded by the dice.

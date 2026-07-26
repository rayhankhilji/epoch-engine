# Cognition

How an agent in Epoch actually thinks, and why it is built this way.

## The problem

The design goal is *LLM-first*: every decision an agent makes should be made by a real language model,
not by a scripted behaviour tree with a model bolted on for flavour.

The naive reading of "every minute they think, every hour they act, every day the world changes" is one
model call per agent per simulated minute. For 200 agents that is 288,000 calls per simulated day. At a
cent a call that is $2,880 to simulate a single day, and you would be rate-limited into the ground long
before you got there.

So Epoch separates *noticing* from *thinking*.

## Three loops

### 1. Appraise — every sim-minute, free

`appraise()` in [`cognition.ts`](../packages/core/src/cognition.ts) is pure arithmetic over the agent's
own state and immediate surroundings. It never calls a model and allocates almost nothing.

It scores what is pressing:

- **Body** — exhaustion, deteriorating health, chronic stress, low mood
- **Money** — runway under three months, this month's bills unpayable
- **Work** — no job, or a company with under four months of runway
- **Goals** — a deadline closing in on something that is behind schedule
- **Ambient** — things that happened nearby, or to someone they know

It returns a `salience` score and the single most pressing thing, phrased as the agent would think it:
*"I am running out of money"*. That phrase then seeds memory retrieval for the next real decision.

Escalation is personal. The threshold is

```ts
0.82 - neuroticism * 0.15 + discipline * 0.08
```

so an anxious agent interrupts its own schedule sooner than a steady one. When salience crosses the
threshold, the agent gets an unscheduled decision even if it was asleep.

### 2. Act — every sim-hour, one call

Every awake agent receives a **situation report** and returns one action.

The report is the agent's entire conscious view of the world, written in the second person:

```
# You
Tomas Vance, 31, male. Software Engineer at Thea Labs. MSc Computer Science.
You live in London, United Kingdom.
Values: security, knowledge, excellence. Politics: Social Democrat.
Personality — openness 64%, conscientiousness 64%, extraversion 47%, …

# Right now
Wednesday 29 Jul 2026, 09:35 local time in London.
Weather: light rain, 11°C.
Energy 39%, health 88%, stress 0%, mood 92%, confidence 65%.
Normally at this hour you would be: work.
What is pressing on you: my company is nearly out of runway.

# Money
Cash 42.1k GBP. Salary 60.8k GBP/yr. Monthly outgoings 3.9k GBP.
Runway: 8.4 months at current burn.
You own 78% of Thea Labs (id: org_3) — valued $2.34M, $180k in the bank,
burning $31k/mo against $12k/mo revenue, runway 5.7 months.

# What you want
- Build a company worth over $1 billion — 22% of the way there.

# What you believe
- I hate owing people money (74% sure)

# What comes to mind
- 3d ago: Ada passed on the round but said to come back with revenue.
- 1d ago: I chose to fundraise because: runway is the only thing that matters now.

# People you know
- Ada Okonjo (id: agent_p) — Founder, close-friend. Affinity +0.62, trust 71%. In San Francisco.

# In the news
- Google Discloses $94.1B in SpaceX Stock (Hacker News)

# Markets
AAPL 333.02 USD (+3.53%) · ^GSPC 7411.98 USD (+0.05%) · bitcoin 64697.00 USD (+0.87%)

# Where you could go
- Amsterdam, Netherlands (id: city:amsterdam) — 357 km, cost of living 92, …

# What you can do with this hour
- work: Do your job for an hour. Builds skill, earns your salary, drains energy.
- fundraise: Pitch investors for capital. Only possible if you own a company.
…
```

The response is a JSON object constrained by a schema: an action, its arguments, a one-line
first-person justification, and the agent's own expected value for the choice.

**Every number in that report is real.** The runway is computed from the company's actual burn. The
market prices came from Yahoo Finance an hour ago. The weather came from Open-Meteo. If the agent
decides it cannot afford the flight, it genuinely cannot.

### 3. Reflect — every sim-day, one call

At the end of each simulated day the agent reads back its own recent life and produces:

- **Beliefs** — durable first-person conclusions, with a confidence and a topic
- **Goal updates** — add, abandon, re-prioritise, or claim progress
- **A mood** — how it feels about its life today

This is where character forms. An agent that has been burned by debt twice writes *"I hate owing people
money"*, and that sentence is then in front of it for every subsequent decision.

Two guards on this loop:

- **Terminal goals are not abandoned on a bad day.** A goal the scenario handed the agent as its
  purpose can only be worn down — its priority drops, but it survives.
- **Progress claims are damped.** Agents are optimistic about themselves, so a claimed jump is applied
  at half strength.

## Memory

### Retrieval

Before every decision the entire episodic stream is scored:

```
score = w_recency · decay^hours_since_access
      + w_importance · importance
      + w_relevance · cosine(query, memory)
```

Relevance is TF-IDF cosine similarity over a sparse lexical vector, not an embedding. That is a
deliberate trade: it makes retrieval free, synchronous, offline, deterministic and dependency-free, at
the cost of missing pure-synonym matches. At hundreds of retrievals per simulated hour that trade is
overwhelmingly worth it.

Retrieved memories are marked as accessed, which resets their recency decay — **memories you revisit
stay available**, exactly like the real thing.

### Forgetting

The stream is capped. When it overflows, entries are ranked by durability:

```
durability = importance·2 + log1p(access_count)·0.6 + (is_reflection ? 1.5 : 0) - log1p(age_hours)·0.25
```

and the least durable quarter is dropped. Reflections and often-revisited moments survive; a Tuesday
lunch from eight months ago does not. This is also what stops a long-running world from growing without
bound.

### The knowledge graph

Actions write facts: founding a company writes `agent —founded→ org`, studying writes
`agent —studies→ skill`, moving writes `agent —lives-in→ city`. Edges reinforce on repetition. The
console renders this as an agent's "what they know" panel.

## When a model misbehaves

Every response passes through `parseDecision` / `parseReflection`, which never throw:

- Unknown action → `idle`
- Non-object args → `{}`
- Out-of-range expected value → clamped
- Unparseable JSON → the router's recovery pass (code fences, prose wrappers, trailing commas,
  truncated output), then a provider fallback, then a safe default

A model having a bad day degrades one agent's hour. It does not stop the world.

## Tuning

| Knob | Where | Effect |
|---|---|---|
| `minutesPerTick` | scenario | How coarse the clock is. 30 or 60 for long runs. |
| `maxConcurrentMinds` | scenario | Ceiling on in-flight model calls during an act phase. |
| `REFLECTION_THRESHOLD` | `memory.ts` | Accumulated importance that forces a reflection. |
| `MAX_STREAM` | `memory.ts` | How much an agent can remember at once. |
| Retrieval weights | `recall()` | Whether agents are ruled by the recent, the important, or the relevant. |

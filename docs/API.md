# HTTP API

The engine serves plain JSON over `node:http`, with Server-Sent Events for the live stream. No
framework, no WebSocket library, no dependencies. Default port `8787` (`PORT` to change).

CORS is open by default for local development; set `EPOCH_CORS_ORIGIN` to lock it down.

## Meta

### `GET /api/health`
```json
{ "ok": true, "worlds": 2, "uptimeSec": 431 }
```

### `GET /api/providers`
Which minds are available, and what model each tier resolves to.
```json
{ "providers": [
  { "id": "anthropic", "label": "Anthropic (Claude)", "configured": true,
    "keysUrl": "https://console.anthropic.com/settings/keys",
    "models": { "fast": "claude-haiku-4-5", "standard": "claude-sonnet-5", "deep": "claude-opus-5" } }
] }
```

### `GET /api/sources`
The live data sources, with provenance. Every entry has `requiresKey: false`.

### `GET /api/scenarios?days=30`
Available scenarios with a cost estimate for `days` simulated days.

## Worlds

### `GET /api/worlds`
```json
{ "worlds": [ /* loaded in memory, full summaries */ ],
  "stored": [ /* persisted but not loaded — open one to resume it */ ] }
```

### `POST /api/worlds`
```json
{
  "scenarioId": "unicorn",
  "provider": "anthropic",     // optional — forces every agent onto one provider
  "seed": 1729,                // optional
  "population": 24,            // optional
  "liveData": true,            // optional
  "tickDelayMs": 120,          // optional — real ms between ticks
  "stopAfterDays": 30,         // optional — 0 runs forever
  "autostart": true            // default true
}
```
→ `201` with a world summary.

### `GET /api/worlds/:id`
```json
{
  "id": "…", "name": "The Unicorn", "status": "running",
  "t": 169200000, "tick": 94, "clock": "29 Jul 2026 · 09:35",
  "stats": { "simDays": 2, "decisions": 1478, "events": 288, "deaths": 0, "orgsFounded": 4 },
  "llm": { "calls": 1612, "costUSD": 2.84, "byProvider": { … } },
  "counts": { "agents": 27, "alive": 27, "cities": 3, "organizations": 4, "events": 288 },
  "mood": 0.79, "warnings": [ … ]
}
```

A world that is persisted but not loaded is rehydrated on first touch, so any endpoint works on a saved
world without an explicit resume.

### `DELETE /api/worlds/:id`
Removes it from memory and from the database.

### `POST /api/worlds/:id/control`
```json
{ "action": "play" }
{ "action": "pause" }
{ "action": "step", "ticks": 2 }
{ "action": "speed", "tickDelayMs": 300 }
```
→ the updated world summary. `step` only works while paused.

## World contents

| Endpoint | Returns |
|---|---|
| `GET /api/worlds/:id/agents` | Everyone, sorted by net worth. `?includeDead=true` for the dead. |
| `GET /api/worlds/:id/agents/:agentId` | One person in full — see below. |
| `GET /api/worlds/:id/cities` | Cities with residents, mood, median wealth and current weather. |
| `GET /api/worlds/:id/organizations` | Companies with valuation, headcount and runway. |
| `GET /api/worlds/:id/graph?minStrength=0.15` | Relationship graph as `{ nodes, edges }`. |
| `GET /api/worlds/:id/markets` | Live quotes, FX rates and the news the agents can see. |
| `GET /api/worlds/:id/economy` | Wealth distribution buckets, Gini coefficient, median, total. |

### `GET /api/worlds/:id/events`

Served from SQLite, so the **full** history is queryable — not just what is resident in memory.

| Query param | Meaning |
|---|---|
| `limit` | Max events, capped at 1000 (default 100) |
| `minImportance` | `0`–`1`. Above ~`0.5` is the headline feed. |
| `agentId` | Only events involving one person |
| `category` | `life` · `career` · `economy` · `social` · `travel` · `health` · `world` · `cognition` · `system` |

Newest first.

### Agent detail

`GET /api/worlds/:id/agents/:agentId` returns everything: identity, personality, traits, values,
politics, religion, skills, reputation, finances (with runway and ownership stakes), goals, current
plan, distilled beliefs, the recent memory stream, the knowledge graph, the social circle, and the
agent's entire life timeline read back from storage.

`runwayMonths` is `null` rather than `Infinity` when income covers outgoings — JSON has no infinity, and
the console renders `null` as *stable*.

## Live stream

### `GET /api/worlds/:id/stream`

Server-Sent Events. `EventSource` reconnects on its own, so a slept laptop or a restarted server heals
without any client-side reconnect logic. A comment heartbeat every 20s keeps proxies from dropping it.

```
data: {"type":"open","worldId":"…"}

data: {"type":"event","worldId":"…","payload":{ /* WorldEvent */ }}

data: {"type":"tick","worldId":"…","payload":{"t":169200000,"tick":94,"stats":{…},"llm":{…}}}

data: {"type":"status","worldId":"…","payload":{"status":"paused","tickDelayMs":120}}

data: {"type":"warning","worldId":"…","payload":{"message":"GDELT unavailable"}}
```

Ticks arrive far faster than a UI should re-render, so buffer them — the console flushes every 250ms.

## Errors

```json
{ "error": "World abc not found" }
```

`400` bad request · `404` unknown route or missing resource · `500` unexpected. Request bodies over 1MB
are rejected.

## Example

```bash
# start a world and watch it
W=$(curl -s -X POST localhost:8787/api/worlds \
      -H 'content-type: application/json' \
      -d '{"scenarioId":"unicorn","tickDelayMs":200}' | jq -r .id)

curl -N "localhost:8787/api/worlds/$W/stream"

# the headlines so far
curl -s "localhost:8787/api/worlds/$W/events?limit=20&minImportance=0.7" | jq '.events[].title'

# one person's whole life
A=$(curl -s "localhost:8787/api/worlds/$W/agents" | jq -r '.agents[0].id')
curl -s "localhost:8787/api/worlds/$W/agents/$A" | jq '{name, beliefs, goals}'
```

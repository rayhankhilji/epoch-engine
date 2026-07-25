/**
 * The HTTP API.
 *
 * Plain `node:http` and Server-Sent Events — no framework, no WebSocket
 * library, no dependencies at all. Events only ever flow server-to-client, so
 * SSE is exactly the right tool and it survives proxies that mangle upgrades.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { providerStatus } from '@epoch/llm';
import { SOURCES } from '@epoch/world';
import { SCENARIOS, estimateCostUSD } from './scenarios.ts';
import type { Runtime } from './runtime.ts';
import type { Store } from './store.ts';
import {
  agentDetail,
  agentSummary,
  cities,
  markets,
  organizations,
  relationshipGraph,
  wealthDistribution,
  worldSummary,
} from './views.ts';

export interface ApiOptions {
  runtime: Runtime;
  store: Store;
  port?: number;
}

export function createApi({ runtime, store, port = Number(process.env.PORT ?? 8787) }: ApiOptions) {
  const server = createServer((req, res) => {
    handle(req, res, runtime, store).catch((error: unknown) => {
      send(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  return {
    server,
    listen(): Promise<number> {
      return new Promise((resolve) => {
        server.listen(port, () => resolve(port));
      });
    },
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: Runtime,
  store: Store,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  // ── Meta ──────────────────────────────────────────────────────────────────

  if (path === '/api/health') {
    return send(res, 200, { ok: true, worlds: runtime.list().length, uptimeSec: Math.round(process.uptime()) });
  }

  if (path === '/api/providers') {
    return send(res, 200, { providers: providerStatus() });
  }

  if (path === '/api/sources') {
    return send(res, 200, { sources: SOURCES });
  }

  if (path === '/api/scenarios') {
    const days = Number(url.searchParams.get('days') ?? 30);
    return send(res, 200, {
      scenarios: SCENARIOS.map((scenario) => ({
        id: scenario.id,
        name: scenario.name,
        summary: scenario.summary,
        description: scenario.description,
        population: scenario.population ?? 0,
        cities: scenario.cityIds?.length ?? 'all',
        namedAgents: scenario.agents?.length ?? 0,
        callsPerSimDay: scenario.callsPerSimDay,
        estimatedCostUSD: Number(estimateCostUSD(scenario, days).toFixed(2)),
      })),
    });
  }

  // ── Worlds ────────────────────────────────────────────────────────────────

  if (path === '/api/worlds' && req.method === 'GET') {
    const live = runtime.list().map(worldSummary);
    const liveIds = new Set(live.map((w) => w.id));
    const stored = store.listWorlds().filter((record) => !liveIds.has(record.id));
    return send(res, 200, { worlds: live, stored });
  }

  if (path === '/api/worlds' && req.method === 'POST') {
    const body = await readJson<{
      scenarioId?: string;
      provider?: string;
      seed?: number;
      population?: number;
      liveData?: boolean;
      tickDelayMs?: number;
      stopAfterDays?: number;
      autostart?: boolean;
    }>(req);

    if (!body.scenarioId) return send(res, 400, { error: 'scenarioId is required' });

    const running = runtime.create({
      scenarioId: body.scenarioId,
      provider: body.provider,
      seed: body.seed,
      population: body.population,
      liveData: body.liveData,
      tickDelayMs: body.tickDelayMs,
      stopAfterDays: body.stopAfterDays,
    });

    if (body.autostart !== false) runtime.play(running.id);
    return send(res, 201, worldSummary(running));
  }

  const worldMatch = path.match(/^\/api\/worlds\/([^/]+)(?:\/(.*))?$/);
  if (!worldMatch) return send(res, 404, { error: `No route for ${path}` });

  const worldId = worldMatch[1]!;
  const rest = worldMatch[2] ?? '';

  // Bring a persisted world back into memory on first touch.
  let running = runtime.get(worldId) ?? runtime.resume(worldId) ?? undefined;
  if (!running) return send(res, 404, { error: `World ${worldId} not found` });

  const { world } = running;

  switch (rest) {
    case '':
      if (req.method === 'DELETE') {
        runtime.remove(worldId);
        store.deleteWorld(worldId);
        return send(res, 200, { deleted: worldId });
      }
      return send(res, 200, worldSummary(running));

    case 'agents': {
      const agents = Object.values(world.agents)
        .filter((agent) => url.searchParams.get('includeDead') === 'true' || agent.alive)
        .map((agent) => agentSummary(world, agent))
        .sort((a, b) => b.netWorthUSD - a.netWorthUSD);
      return send(res, 200, { agents });
    }

    case 'cities':
      return send(res, 200, { cities: cities(world) });

    case 'organizations':
      return send(res, 200, { organizations: organizations(world) });

    case 'graph':
      return send(res, 200, relationshipGraph(world, Number(url.searchParams.get('minStrength') ?? 0.15)));

    case 'markets':
      return send(res, 200, markets(world));

    case 'economy':
      return send(res, 200, wealthDistribution(world));

    case 'events': {
      // Served from SQLite so the full history is queryable, not just what is
      // still in memory.
      const events = store.queryEvents(worldId, {
        limit: Number(url.searchParams.get('limit') ?? 100),
        minImportance: url.searchParams.has('minImportance')
          ? Number(url.searchParams.get('minImportance'))
          : undefined,
        agentId: url.searchParams.get('agentId') ?? undefined,
        category: url.searchParams.get('category') ?? undefined,
      });
      return send(res, 200, { events });
    }

    case 'stream':
      return stream(req, res, runtime, worldId);

    case 'control': {
      const body = await readJson<{ action?: string; tickDelayMs?: number; ticks?: number }>(req);
      switch (body.action) {
        case 'play':
          runtime.play(worldId);
          break;
        case 'pause':
          runtime.pause(worldId);
          break;
        case 'step':
          await runtime.step(worldId, body.ticks ?? 1);
          break;
        case 'speed':
          runtime.setSpeed(worldId, body.tickDelayMs ?? 0);
          break;
        default:
          return send(res, 400, { error: `Unknown action "${body.action ?? ''}"` });
      }
      running = runtime.get(worldId)!;
      return send(res, 200, worldSummary(running));
    }
  }

  const agentMatch = rest.match(/^agents\/([^/]+)$/);
  if (agentMatch) {
    const agent = world.agents[agentMatch[1]!];
    if (!agent) return send(res, 404, { error: `Agent ${agentMatch[1]} not found` });
    return send(res, 200, agentDetail(world, agent));
  }

  return send(res, 404, { error: `No route for ${path}` });
}

// ─────────────────────────────────────────────────────────────────────────────
// Server-Sent Events
// ─────────────────────────────────────────────────────────────────────────────

function stream(req: IncomingMessage, res: ServerResponse, runtime: Runtime, worldId: string): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const write = (message: unknown) => {
    res.write(`data: ${JSON.stringify(message)}\n\n`);
  };

  write({ type: 'open', worldId });

  const unsubscribe = runtime.subscribe(worldId, write);

  // Proxies drop idle connections; a comment every 20s keeps this one alive.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);

  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  };

  req.on('close', close);
  req.on('error', close);
}

// ─────────────────────────────────────────────────────────────────────────────

function cors(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', process.env.EPOCH_CORS_ORIGIN ?? '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error('Request body too large');
    chunks.push(chunk as Buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw === '') return {} as T;

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error('Request body was not valid JSON');
  }
}

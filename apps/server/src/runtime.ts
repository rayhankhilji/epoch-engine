/**
 * The runtime.
 *
 * Owns every world currently loaded in the process: starts them, paces them,
 * pauses them, autosaves them, and fans their events out to whoever is
 * watching. A world keeps running whether or not anyone has the UI open.
 */

import { randomUUID } from 'node:crypto';
import {
  Simulation,
  createWorld,
  type World,
  type WorldEvent,
} from '@epoch/core';
import { createMind, resolveProvider, type Mind } from '@epoch/llm';
import { createWorldData } from '@epoch/world';
import { getScenario, type ScenarioDefinition } from './scenarios.ts';
import { Store } from './store.ts';

export type RunStatus = 'paused' | 'running' | 'finished' | 'error';

export interface StreamMessage {
  type: 'event' | 'tick' | 'status' | 'warning';
  worldId: string;
  payload: unknown;
}

type Listener = (message: StreamMessage) => void;

export interface RunningWorld {
  id: string;
  scenarioId: string;
  world: World;
  sim: Simulation;
  mind: Mind;
  status: RunStatus;
  /** Real milliseconds to wait between ticks. Lower is faster. */
  tickDelayMs: number;
  /** Stop automatically after this many sim-days. 0 = run forever. */
  stopAfterDays: number;
  warnings: string[];
  startedAt: number;
  savedEvents: number;
}

export interface CreateOptions {
  scenarioId: string;
  /** Force every agent onto one provider, overriding the scenario's mix. */
  provider?: string;
  seed?: number;
  population?: number;
  liveData?: boolean;
  tickDelayMs?: number;
  stopAfterDays?: number;
}

export class Runtime {
  private readonly worlds = new Map<string, RunningWorld>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  list(): RunningWorld[] {
    return [...this.worlds.values()];
  }

  get(id: string): RunningWorld | undefined {
    return this.worlds.get(id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Creation
  // ───────────────────────────────────────────────────────────────────────────

  create(options: CreateOptions): RunningWorld {
    const scenario = getScenario(options.scenarioId);
    const id = randomUUID();

    const definition: ScenarioDefinition = {
      ...scenario,
      seed: options.seed ?? scenario.seed,
      population: options.population ?? scenario.population,
      liveData: options.liveData ?? true,
      // A single-provider run overrides the scenario's deliberate mix.
      minds: options.provider ? [{ provider: options.provider }] : scenario.minds,
    };

    const world = createWorld(definition);
    return this.attach(id, scenario.id, world, options);
  }

  /** Rehydrate a world from the database and make it runnable again. */
  resume(id: string, options: Partial<CreateOptions> = {}): RunningWorld | null {
    if (this.worlds.has(id)) return this.worlds.get(id)!;

    const world = this.store.loadWorld(id);
    if (!world) return null;

    const record = this.store.listWorlds().find((w) => w.id === id);
    return this.attach(id, record?.scenarioId ?? 'unknown', world, options);
  }

  private attach(id: string, scenarioId: string, world: World, options: Partial<CreateOptions>): RunningWorld {
    const mind = createMind({
      onWarning: (message, detail) => this.warn(id, message, detail),
    });

    // Pin "auto" down to the provider it actually resolved to, so the UI can
    // honestly say which model is behind each agent.
    for (const agent of Object.values(world.agents)) {
      if (agent.mind.provider === 'auto') agent.mind.provider = resolveProvider('auto').id;
    }

    const running: RunningWorld = {
      id,
      scenarioId,
      world,
      mind,
      status: 'paused',
      tickDelayMs: options.tickDelayMs ?? 0,
      stopAfterDays: options.stopAfterDays ?? 0,
      warnings: [],
      startedAt: Date.now(),
      savedEvents: this.store.countEvents(id),
      sim: null as unknown as Simulation,
    };

    running.sim = new Simulation({
      world,
      mind: mind.fn,
      data: world.config.liveData
        ? createWorldData({ onWarning: (message, detail) => this.warn(id, message, detail) })
        : undefined,
      onEvent: (event: WorldEvent) => this.broadcast(id, { type: 'event', worldId: id, payload: event }),
      onWarning: (message, detail) => this.warn(id, message, detail),
    });

    this.worlds.set(id, running);
    this.store.saveWorld(id, scenarioId, world);
    this.persistEvents(running);
    return running;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Control
  // ───────────────────────────────────────────────────────────────────────────

  play(id: string): RunningWorld | undefined {
    const running = this.worlds.get(id);
    if (!running || running.status === 'running') return running;

    running.status = 'running';
    this.broadcastStatus(running);
    void this.loop(running);
    return running;
  }

  pause(id: string): RunningWorld | undefined {
    const running = this.worlds.get(id);
    if (!running) return undefined;

    running.sim.stop();
    running.status = 'paused';
    this.save(running);
    this.broadcastStatus(running);
    return running;
  }

  /** Advance exactly one tick. Useful for inspecting a world frame by frame. */
  async step(id: string, ticks = 1): Promise<RunningWorld | undefined> {
    const running = this.worlds.get(id);
    if (!running || running.status === 'running') return running;

    for (let i = 0; i < ticks; i++) await running.sim.tick();

    this.afterTick(running);
    this.save(running);
    return running;
  }

  setSpeed(id: string, tickDelayMs: number): RunningWorld | undefined {
    const running = this.worlds.get(id);
    if (!running) return undefined;
    running.tickDelayMs = Math.max(0, Math.min(10_000, tickDelayMs));
    this.broadcastStatus(running);
    return running;
  }

  remove(id: string): void {
    const running = this.worlds.get(id);
    if (!running) return;
    running.sim.stop();
    running.sim.dispose();
    this.save(running);
    this.worlds.delete(id);
    this.listeners.delete(id);
  }

  /** Pause and persist everything. Called on SIGINT so a run is never lost. */
  shutdown(): void {
    for (const running of this.worlds.values()) {
      running.sim.stop();
      running.status = 'paused';
      this.save(running);
      running.sim.dispose();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // The loop
  // ───────────────────────────────────────────────────────────────────────────

  private async loop(running: RunningWorld): Promise<void> {
    try {
      while (running.status === 'running') {
        await running.sim.tick();
        this.afterTick(running);

        if (running.stopAfterDays > 0 && running.world.stats.simDays >= running.stopAfterDays) {
          running.status = 'finished';
          this.save(running);
          this.broadcastStatus(running);
          break;
        }

        // Autosave often enough that a crash costs seconds, not hours.
        if (running.world.tick % 20 === 0) this.save(running);

        if (running.tickDelayMs > 0) await sleep(running.tickDelayMs);
        else await new Promise((resolve) => setImmediate(resolve));
      }
    } catch (error) {
      running.status = 'error';
      this.warn(running.id, 'The world stopped', error);
      this.save(running);
      this.broadcastStatus(running);
    }
  }

  private afterTick(running: RunningWorld): void {
    this.persistEvents(running);
    this.broadcast(running.id, {
      type: 'tick',
      worldId: running.id,
      payload: {
        t: running.world.t,
        tick: running.world.tick,
        stats: running.world.stats,
        llm: running.mind.stats,
      },
    });
  }

  private persistEvents(running: RunningWorld): void {
    const timeline = running.world.timeline;
    if (timeline.length <= running.savedEvents) return;

    const fresh = timeline.slice(running.savedEvents);
    this.store.appendEvents(running.id, fresh, running.savedEvents);
    running.savedEvents = timeline.length;
  }

  private save(running: RunningWorld): void {
    this.persistEvents(running);
    this.store.saveWorld(running.id, running.scenarioId, running.world);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Streaming
  // ───────────────────────────────────────────────────────────────────────────

  subscribe(worldId: string, listener: Listener): () => void {
    const set = this.listeners.get(worldId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(worldId, set);
    return () => set.delete(listener);
  }

  private broadcast(worldId: string, message: StreamMessage): void {
    for (const listener of this.listeners.get(worldId) ?? []) {
      try {
        listener(message);
      } catch {
        // A disconnected client must never interfere with the simulation.
      }
    }
  }

  private broadcastStatus(running: RunningWorld): void {
    this.broadcast(running.id, {
      type: 'status',
      worldId: running.id,
      payload: { status: running.status, tickDelayMs: running.tickDelayMs },
    });
  }

  private warn(worldId: string, message: string, detail?: unknown): void {
    const running = this.worlds.get(worldId);
    if (running) {
      running.warnings.push(message);
      if (running.warnings.length > 100) running.warnings.shift();
    }
    this.broadcast(worldId, {
      type: 'warning',
      worldId,
      payload: { message, detail: detail instanceof Error ? detail.message : detail },
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

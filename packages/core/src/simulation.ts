/**
 * The engine.
 *
 * `Simulation` owns the clock and orchestrates the three cognition loops
 * described in `cognition.ts`, plus the world's own machinery: markets settle,
 * companies burn cash, relationships fade, people age and eventually die.
 *
 * It is deliberately unopinionated about *where* thinking happens. Hand it a
 * `MindFn` and it will drive agents through whichever models you have keys for.
 */

import type {
  Agent,
  City,
  MindFn,
  MindResponse,
  NewsItem,
  Quote,
  Weather,
  World,
  WorldEvent,
} from './types.ts';
import { Rng, clamp } from './rng.ts';
import { DAY, HOUR, MINUTE, boundariesCrossed, isAsleep, localParts } from './time.ts';
import { appraise, buildActRequest, buildPlanRequest, buildReflectRequest, parseDecision, parseReflection, type Appraisal } from './cognition.ts';
import { executeAction, resolveArrivals } from './actions.ts';
import { addBelief, clearReflectionDebt, remember, shouldReflect } from './memory.ts';
import { decayRelationships } from './social.ts';
import { depreciate, operateOrganizations, settleMonth } from './economy.ts';
import { emit, onEvent } from './events.ts';
import { makeGoal } from './world.ts';
import { nextId } from './ids.ts';

/**
 * Optional live-data hooks. `@epoch/world` implements these against free,
 * keyless public APIs; without it the simulation runs perfectly well on its
 * own internal economy.
 */
export interface WorldDataSource {
  fetchWeather?(cities: City[]): Promise<Weather[]>;
  fetchMarket?(): Promise<{ quotes: Record<string, Quote>; fx: Record<string, number> }>;
  fetchNews?(topics: string[]): Promise<NewsItem[]>;
}

export interface SimulationOptions {
  world: World;
  /** Where thinking happens. Required — every decision in Epoch is model-made. */
  mind: MindFn;
  data?: WorldDataSource;
  /** Called for every event as it happens. */
  onEvent?: (event: WorldEvent) => void;
  /** Called after each tick, for streaming state to a UI. */
  onTick?: (world: World) => void;
  /** Surface non-fatal problems (a provider erroring, a bad response) without stopping the world. */
  onWarning?: (message: string, detail?: unknown) => void;
}

export class Simulation {
  readonly world: World;
  private readonly mind: MindFn;
  private readonly data?: WorldDataSource;
  private readonly onTick?: (world: World) => void;
  private readonly onWarning: (message: string, detail?: unknown) => void;
  private readonly rng: Rng;
  private readonly unsubscribe: () => void;

  /** Agents whose appraisal escalated between scheduled hourly decisions. */
  private urgent = new Set<string>();
  private lastAppraisal = new Map<string, Appraisal>();
  private running = false;
  private stopRequested = false;

  constructor(options: SimulationOptions) {
    this.world = options.world;
    this.mind = options.mind;
    this.data = options.data;
    this.onTick = options.onTick;
    this.onWarning = options.onWarning ?? (() => {});
    this.rng = Rng.fromState(options.world.rngState);
    this.unsubscribe = options.onEvent ? onEvent(options.onEvent) : () => {};
  }

  /** Release the event subscription. Call when discarding a simulation. */
  dispose(): void {
    this.unsubscribe();
  }

  get isRunning(): boolean {
    return this.running;
  }

  stop(): void {
    this.stopRequested = true;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Driving the clock
  // ───────────────────────────────────────────────────────────────────────────

  /** Advance the world by one tick, running whichever phases the clock crosses. */
  async tick(): Promise<void> {
    const world = this.world;
    const previous = world.t;
    world.t += world.config.minutesPerTick * MINUTE;
    world.tick++;
    world.stats.ticks++;

    const crossed = boundariesCrossed(world.config.startISO, previous, world.t);

    // Every minute: free appraisal. This is the "they think every minute" layer.
    this.appraisePhase();

    if (crossed.hour) {
      resolveArrivals(world);
      this.metabolisePhase();
      await this.actPhase();
    }

    if (crossed.day) {
      world.stats.simDays++;
      decayRelationships(world);
      await this.refreshWorldData();
      await this.reflectPhase();
    }

    if (crossed.month) {
      settleMonth(world, this.rng);
      operateOrganizations(world, this.rng);
    }

    if (crossed.year) {
      this.annualPhase();
    }

    world.rngState = this.rng.state;
    this.onTick?.(world);
  }

  /** Run `ticks` ticks, or until `stop()` is called. */
  async run(ticks: number): Promise<void> {
    this.running = true;
    this.stopRequested = false;
    try {
      for (let i = 0; i < ticks && !this.stopRequested; i++) {
        await this.tick();
      }
    } finally {
      this.running = false;
    }
  }

  /** Advance a whole simulated day, whatever the tick size. */
  async runDays(days: number): Promise<void> {
    const ticksPerDay = DAY / (this.world.config.minutesPerTick * MINUTE);
    await this.run(Math.round(ticksPerDay * days));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Phases
  // ───────────────────────────────────────────────────────────────────────────

  /** Free. Runs for every agent, every minute. Never calls a model. */
  private appraisePhase(): void {
    for (const agent of Object.values(this.world.agents)) {
      if (!agent.alive) continue;
      const appraisal = appraise(this.world, agent);
      this.lastAppraisal.set(agent.id, appraisal);
      if (appraisal.urgent) this.urgent.add(agent.id);
    }
  }

  /** Bodies drift regardless of what anyone decides. */
  private metabolisePhase(): void {
    for (const agent of Object.values(this.world.agents)) {
      if (!agent.alive) continue;
      const city = this.world.cities[agent.cityId];
      const asleep = isAsleep(this.world, city?.timezone ?? 'UTC');

      if (asleep) {
        agent.state.energy = clamp(agent.state.energy + 0.055);
        agent.state.stress = clamp(agent.state.stress - 0.02);
      } else {
        agent.state.energy = clamp(agent.state.energy - 0.018);
      }

      // Chronic stress and exhaustion erode health slowly but genuinely.
      if (agent.state.stress > 0.75) agent.state.health = clamp(agent.state.health - 0.0012);
      if (agent.state.energy < 0.15) agent.state.health = clamp(agent.state.health - 0.0008);
      if (agent.state.health > 0.85 && agent.state.stress < 0.4) {
        agent.state.health = clamp(agent.state.health + 0.0003);
      }

      // Mood converges on satisfaction; satisfaction moves only through living.
      agent.state.mood = clamp(agent.state.mood + (agent.state.satisfaction - agent.state.mood) * 0.02);
    }
  }

  /**
   * The hourly decision. Every awake agent gets one LLM call; sleeping agents
   * are skipped unless something urgent woke them.
   */
  private async actPhase(): Promise<void> {
    const world = this.world;
    const candidates = Object.values(world.agents).filter((agent) => {
      if (!agent.alive) return false;
      if (agent.travellingTo) return false;
      const city = world.cities[agent.cityId];
      const asleep = isAsleep(world, city?.timezone ?? 'UTC');
      return !asleep || this.urgent.has(agent.id);
    });

    await mapWithConcurrency(candidates, world.config.maxConcurrentMinds, async (agent) => {
      await this.decideAndAct(agent);
    });

    this.urgent.clear();
  }

  private async decideAndAct(agent: Agent): Promise<void> {
    const world = this.world;
    const appraisal = this.lastAppraisal.get(agent.id) ?? appraise(world, agent);

    let response: MindResponse;
    try {
      response = await this.mind(buildActRequest(world, agent, appraisal));
    } catch (error) {
      this.onWarning(`${agent.name} could not think this hour`, error);
      return;
    }
    this.accountUsage(response);

    const decision = parseDecision(response.data);
    world.stats.decisions++;

    const outcome = executeAction(world, this.rng, agent, decision.action, decision.args, decision.reasoning);

    // The agent's own narration of why is part of what it will remember later.
    remember(agent, world.t, {
      kind: 'plan',
      text: `I chose to ${decision.action.replace(/_/g, ' ')} because: ${decision.reasoning}`,
      importance: clamp(decision.expectedValue * 0.4),
      valence: outcome.valence * 0.5,
    });

    if (decision.revisePlan || (!agent.plan && agent.goals.some((g) => g.terminal))) {
      await this.replan(agent);
    } else if (agent.plan) {
      // Mark the first pending step done when the agent actually took that action.
      const step = agent.plan.steps.find((s) => !s.done && s.action === decision.action);
      if (step) step.done = true;
    }
  }

  /** Ask the agent to work out a strategy for its most important goal. */
  private async replan(agent: Agent): Promise<void> {
    const goal =
      agent.goals.filter((g) => g.status === 'active').sort((a, b) => b.priority - a.priority)[0];
    if (!goal) return;

    let response: MindResponse;
    try {
      response = await this.mind(buildPlanRequest(this.world, agent, goal.title));
    } catch (error) {
      this.onWarning(`${agent.name} could not form a plan`, error);
      return;
    }
    this.accountUsage(response);

    const raw = (response.data ?? {}) as Record<string, unknown>;
    const steps = Array.isArray(raw.steps) ? raw.steps : [];
    if (steps.length === 0) return;

    agent.plan = {
      id: nextId('plan'),
      goalId: goal.id,
      strategy: typeof raw.strategy === 'string' ? raw.strategy : 'Work it out as I go.',
      horizonDays: typeof raw.horizonDays === 'number' ? raw.horizonDays : 90,
      createdAt: this.world.t,
      revisedAt: this.world.t,
      steps: steps
        .filter((s): s is Record<string, unknown> => s != null && typeof s === 'object')
        .map((s) => ({
          summary: String(s.summary ?? ''),
          action: (typeof s.action === 'string' ? s.action : 'idle') as never,
          args: (s.args && typeof s.args === 'object' ? s.args : {}) as Record<string, unknown>,
          expectedValue: clamp(typeof s.expectedValue === 'number' ? s.expectedValue : 0.5),
          done: false,
        })),
    };

    remember(agent, this.world.t, {
      kind: 'plan',
      text: `New plan for "${goal.title}": ${agent.plan.strategy}`,
      importance: 0.7,
      valence: 0.3,
    });

    emit(this.world, {
      category: 'cognition',
      title: `${agent.name} formed a plan`,
      detail: `${goal.title}: ${agent.plan.strategy}`,
      agentIds: [agent.id],
      cityId: agent.cityId,
      importance: 0.55,
    });
  }

  /**
   * The daily consolidation. Agents who have had an uneventful day reflect
   * anyway but cheaply; agents carrying a lot of unprocessed importance always
   * reflect.
   */
  private async reflectPhase(): Promise<void> {
    const world = this.world;
    const candidates = Object.values(world.agents).filter(
      (agent) => agent.alive && (shouldReflect(agent) || agent.memory.stream.length > 0),
    );

    await mapWithConcurrency(candidates, world.config.maxConcurrentMinds, async (agent) => {
      let response: MindResponse;
      try {
        response = await this.mind(buildReflectRequest(world, agent));
      } catch (error) {
        this.onWarning(`${agent.name} could not reflect`, error);
        return;
      }
      this.accountUsage(response);

      const reflection = parseReflection(response.data);

      for (const belief of reflection.beliefs) {
        const evidence = agent.memory.stream.slice(-8).map((m) => m.id);
        addBelief(agent, world.t, belief.statement, belief.confidence, belief.topic, evidence);
        remember(agent, world.t, {
          kind: 'reflection',
          text: belief.statement,
          importance: 0.55 + belief.confidence * 0.3,
          valence: 0,
        });
      }

      this.applyGoalUpdates(agent, reflection.goalUpdates);

      agent.state.satisfaction = clamp(agent.state.satisfaction * 0.75 + reflection.mood * 0.25);
      clearReflectionDebt(agent);

      if (reflection.summary) {
        emit(world, {
          category: 'cognition',
          title: `${agent.name} reflected`,
          detail: reflection.summary,
          agentIds: [agent.id],
          cityId: agent.cityId,
          importance: 0.3,
        });
      }
    });
  }

  private applyGoalUpdates(
    agent: Agent,
    updates: Array<{ op: string; title: string; rationale?: string; priority?: number; progress?: number }>,
  ): void {
    for (const update of updates) {
      const existing = agent.goals.find((g) => g.title.toLowerCase() === update.title.toLowerCase());

      switch (update.op) {
        case 'add': {
          if (existing) break;
          if (agent.goals.filter((g) => g.status === 'active').length >= 6) break;
          const goal = makeGoal(update.title, this.rng, false);
          goal.rationale = update.rationale ?? goal.rationale;
          goal.priority = update.priority ?? goal.priority;
          goal.createdAt = this.world.t;
          agent.goals.push(goal);
          emit(this.world, {
            category: 'cognition',
            title: `${agent.name} set a new goal`,
            detail: `${goal.title} — ${goal.rationale}`,
            agentIds: [agent.id],
            cityId: agent.cityId,
            importance: 0.5,
          });
          break;
        }
        case 'abandon': {
          // Terminal goals are what the agent's life is for — they don't get
          // dropped on a bad day, only worn down over time.
          if (!existing) break;
          if (existing.terminal) {
            existing.priority = clamp(existing.priority - 0.05, 0.3, 1);
            break;
          }
          existing.status = 'abandoned';
          emit(this.world, {
            category: 'cognition',
            title: `${agent.name} gave up on a goal`,
            detail: `${existing.title}${update.rationale ? ` — ${update.rationale}` : ''}`,
            agentIds: [agent.id],
            cityId: agent.cityId,
            importance: 0.55,
          });
          break;
        }
        case 'reprioritise': {
          if (existing && update.priority != null) existing.priority = update.priority;
          break;
        }
        case 'progress':
        default: {
          if (!existing || update.progress == null) break;
          const before = existing.progress;
          // Agents are optimistic about their own progress; damp the claim.
          existing.progress = clamp(before + (update.progress - before) * 0.5);
          if (existing.progress >= 0.999 && existing.status === 'active') {
            existing.status = 'achieved';
            emit(this.world, {
              category: 'life',
              title: `${agent.name} achieved: ${existing.title}`,
              detail: existing.rationale,
              agentIds: [agent.id],
              cityId: agent.cityId,
              importance: 1,
            });
          }
          break;
        }
      }
    }
  }

  /** Birthdays, decline, and mortality. */
  private annualPhase(): void {
    const world = this.world;
    for (const agent of Object.values(world.agents)) {
      if (!agent.alive) continue;
      agent.age++;
      depreciate(agent, world.t);

      // Health declines with age, faster if it has been neglected.
      const ageDecline = Math.max(0, (agent.age - 35) / 100) * 0.05;
      agent.state.health = clamp(agent.state.health - ageDecline - agent.state.stress * 0.02);

      // Gompertz-ish mortality, modulated by how well they've actually lived.
      const baseline = 0.00008 * Math.exp(0.085 * agent.age);
      const risk = clamp(baseline * (1.9 - agent.state.health), 0, 0.9);
      if (this.rng.bool(risk)) {
        agent.alive = false;
        world.stats.deaths++;
        emit(world, {
          category: 'life',
          title: `${agent.name} died at ${agent.age}`,
          detail: `${agent.occupation} in ${world.cities[agent.cityId]?.name ?? 'unknown'}.`,
          agentIds: [agent.id],
          cityId: agent.cityId,
          importance: 1,
        });

        // The people who knew them find out.
        for (const other of Object.values(world.agents)) {
          const rel = other.relationships[agent.id];
          if (!other.alive || !rel || rel.familiarity < 0.15) continue;
          remember(other, world.t, {
            kind: 'event',
            text: `${agent.name} died.`,
            importance: 0.6 + rel.familiarity * 0.4,
            valence: -0.6 - rel.affinity * 0.4,
            participants: [agent.id],
          });
          other.state.mood = clamp(other.state.mood - rel.familiarity * 0.3);
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Live world data
  // ───────────────────────────────────────────────────────────────────────────

  private async refreshWorldData(): Promise<void> {
    const world = this.world;
    if (!world.config.liveData || !this.data) return;

    const cities = Object.values(world.cities);
    const topics = [...new Set(Object.values(world.agents).flatMap((a) => a.interests))].slice(0, 12);

    const [weather, market, news] = await Promise.allSettled([
      this.data.fetchWeather?.(cities) ?? Promise.resolve([]),
      this.data.fetchMarket?.() ?? Promise.resolve(null),
      this.data.fetchNews?.(topics) ?? Promise.resolve([]),
    ]);

    if (weather.status === 'fulfilled') {
      for (const observation of weather.value) world.weather[observation.cityId] = observation;
    } else {
      this.onWarning('Weather refresh failed', weather.reason);
    }

    if (market.status === 'fulfilled' && market.value) {
      world.market = { ...market.value, updatedAt: Date.now() };
    } else if (market.status === 'rejected') {
      this.onWarning('Market refresh failed', market.reason);
    }

    if (news.status === 'fulfilled' && news.value.length > 0) {
      world.news = news.value.slice(0, 40);
      const headline = world.news[0];
      if (headline) {
        emit(world, {
          category: 'world',
          title: headline.title,
          detail: `via ${headline.source}`,
          agentIds: [],
          importance: 0.5,
          meta: { url: headline.url, topics: headline.topics },
        });
      }
    } else if (news.status === 'rejected') {
      this.onWarning('News refresh failed', news.reason);
    }
  }

  private accountUsage(response: MindResponse): void {
    const stats = this.world.stats;
    stats.llmCalls++;
    if (!response.usage) return;
    stats.llmTokensIn += response.usage.inputTokens;
    stats.llmTokensOut += response.usage.outputTokens;
    stats.llmCostUSD += response.usage.costUSD;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run `worker` over `items` with at most `limit` in flight. This is the valve
 * that keeps a 500-agent act phase from opening 500 simultaneous connections.
 */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const size = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) continue;
      await worker(item, index);
    }
  });

  await Promise.all(runners);
}


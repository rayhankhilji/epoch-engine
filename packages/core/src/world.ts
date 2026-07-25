/**
 * World construction.
 *
 * A scenario is a small declarative description — which cities exist, how many
 * people live in them, who the named characters are, what they are trying to do
 * and which model powers each mind. `createWorld` turns that into a fully
 * populated, internally consistent society ready to be ticked.
 */

import type {
  Agent,
  City,
  Goal,
  MindConfig,
  World,
  WorldConfig,
  WorldStats,
} from './types.ts';
import { Rng } from './rng.ts';
import { nextId } from './ids.ts';
import { CITIES } from './data/cities.ts';
import { generateAgent } from './agents.ts';
import { seedRelationships } from './social.ts';
import { FALLBACK_FX } from './economy.ts';
import { remember } from './memory.ts';
import { emit } from './events.ts';
import { DAY } from './time.ts';

export interface ScenarioAgent {
  name?: string;
  cityId: string;
  occupation?: string;
  age?: number;
  /** Goals the author hands this character. They work out the rest themselves. */
  goals?: string[];
  mind?: MindConfig;
  /** Any other agent field to pin, e.g. { traits: { ambition: 0.95 } }. */
  overrides?: Partial<Agent>;
}

export interface Scenario {
  name: string;
  description?: string;
  seed?: number;
  /** ISO timestamp the world starts from. Defaults to now. */
  startISO?: string;
  /** City ids to include. Omit for the full default set. */
  cityIds?: string[];
  /** Background population spread across the included cities. */
  population?: number;
  /** Named characters, created after the background population. */
  agents?: ScenarioAgent[];
  /** Goals given to every background agent, in addition to their own. */
  sharedGoals?: string[];
  /**
   * Minds rotated across the background population. Give it several providers
   * and the world becomes a genuinely mixed society of Claude, GPT and Grok
   * agents reasoning against each other.
   */
  minds?: MindConfig[];
  minutesPerTick?: number;
  maxConcurrentMinds?: number;
  liveData?: boolean;
}

export function emptyStats(): WorldStats {
  return {
    ticks: 0,
    simDays: 0,
    decisions: 0,
    llmCalls: 0,
    llmTokensIn: 0,
    llmTokensOut: 0,
    llmCostUSD: 0,
    events: 0,
    deaths: 0,
    orgsFounded: 0,
  };
}

export function createWorld(scenario: Scenario): World {
  const seed = scenario.seed ?? 20260725;
  const rng = new Rng(seed);

  const cityList: City[] =
    scenario.cityIds && scenario.cityIds.length > 0
      ? CITIES.filter((c) => scenario.cityIds!.includes(c.id))
      : CITIES;

  if (cityList.length === 0) {
    throw new Error(`Scenario "${scenario.name}" selected no valid cities. Check cityIds against @epoch/core CITIES.`);
  }

  const config: WorldConfig = {
    name: scenario.name,
    seed,
    startISO: scenario.startISO ?? new Date().toISOString(),
    minutesPerTick: scenario.minutesPerTick ?? 1,
    maxConcurrentMinds: scenario.maxConcurrentMinds ?? 8,
    liveData: scenario.liveData ?? true,
    defaultMind: scenario.minds?.[0] ?? { provider: 'auto' },
  };

  const world: World = {
    config,
    t: 0,
    tick: 0,
    cities: Object.fromEntries(cityList.map((c) => [c.id, structuredClone(c)])),
    agents: {},
    organizations: {},
    weather: {},
    market: { quotes: {}, fx: { ...FALLBACK_FX }, updatedAt: 0 },
    news: [],
    timeline: [],
    rngState: rng.state,
    stats: emptyStats(),
  };

  // Background population, distributed by city size so big cities feel big.
  const population = scenario.population ?? 0;
  const weights = cityList.map((c) => [c, Math.log10(1 + c.population)] as const);
  for (let i = 0; i < population; i++) {
    const city = rng.weighted(weights);
    const mind = scenario.minds && scenario.minds.length > 0 ? scenario.minds[i % scenario.minds.length]! : config.defaultMind;
    const agent = generateAgent(rng, { city, mind });
    if (scenario.sharedGoals) {
      for (const title of scenario.sharedGoals) agent.goals.push(makeGoal(title, rng, true));
    }
    world.agents[agent.id] = agent;
  }

  // Named characters.
  for (const spec of scenario.agents ?? []) {
    const city = world.cities[spec.cityId];
    if (!city) {
      throw new Error(`Scenario "${scenario.name}": agent "${spec.name ?? 'unnamed'}" is in unknown city "${spec.cityId}".`);
    }
    const agent = generateAgent(rng, {
      city,
      occupation: spec.occupation,
      minAge: spec.age,
      maxAge: spec.age,
      mind: spec.mind ?? config.defaultMind,
      overrides: { ...(spec.name ? { name: spec.name } : {}), ...spec.overrides },
    });
    for (const title of spec.goals ?? []) agent.goals.push(makeGoal(title, rng, true));
    for (const title of scenario.sharedGoals ?? []) agent.goals.push(makeGoal(title, rng, false));
    world.agents[agent.id] = agent;
  }

  seedRelationships(world, rng, 4);
  seedOpeningMemories(world, rng);

  world.rngState = rng.state;

  emit(world, {
    category: 'system',
    title: `${config.name} began`,
    detail: `${Object.keys(world.agents).length} agents across ${cityList.length} cities. Seed ${seed}.`,
    agentIds: [],
    importance: 1,
  });

  return world;
}

/**
 * A goal the agent has been handed. Note what is deliberately absent: any
 * instruction on how to achieve it. That is the agent's problem.
 */
export function makeGoal(title: string, rng: Rng, terminal: boolean): Goal {
  return {
    id: nextId('goal'),
    title,
    rationale: terminal ? 'This is what I have decided my life is for.' : 'Something I care about.',
    priority: terminal ? rng.float(0.75, 1) : rng.float(0.2, 0.6),
    progress: 0,
    status: 'active',
    createdAt: 0,
    terminal,
  };
}

/** Give everyone a little history so the first hour isn't a blank slate. */
function seedOpeningMemories(world: World, rng: Rng): void {
  for (const agent of Object.values(world.agents)) {
    const city = world.cities[agent.cityId];
    remember(agent, world.t - 30 * DAY, {
      kind: 'observation',
      text: `I live in ${city?.name ?? 'this city'} and work as a ${agent.occupation}.`,
      importance: 0.3,
      valence: 0.1,
      cityId: agent.cityId,
    });

    for (const goal of agent.goals.filter((g) => g.terminal)) {
      remember(agent, world.t - rng.int(1, 400) * DAY, {
        kind: 'reflection',
        text: `I decided a while ago that what I really want is this: ${goal.title}.`,
        importance: 0.9,
        valence: 0.5,
      });
    }

    const friend = Object.values(agent.relationships).sort((a, b) => b.familiarity - a.familiarity)[0];
    if (friend) {
      const other = world.agents[friend.with];
      if (other) {
        remember(agent, world.t - rng.int(1, 20) * DAY, {
          kind: 'conversation',
          text: `I've known ${other.name} for a while now — they're a ${other.occupation}.`,
          importance: 0.35,
          valence: friend.affinity,
          participants: [agent.id, other.id],
        });
      }
    }
  }
}

/** Add an agent to a running world. */
export function addAgent(world: World, agent: Agent): Agent {
  world.agents[agent.id] = agent;
  emit(world, {
    category: 'life',
    title: `${agent.name} entered the world`,
    detail: `${agent.age}, ${agent.occupation} in ${world.cities[agent.cityId]?.name ?? 'unknown'}.`,
    agentIds: [agent.id],
    cityId: agent.cityId,
    importance: 0.5,
  });
  return agent;
}

export function livingAgents(world: World): Agent[] {
  return Object.values(world.agents).filter((a) => a.alive);
}

export function findAgentByName(world: World, name: string): Agent | undefined {
  const lower = name.toLowerCase();
  return Object.values(world.agents).find((a) => a.name.toLowerCase() === lower);
}

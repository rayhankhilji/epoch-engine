/**
 * View models.
 *
 * The `World` object is large and deeply linked; sending it to a browser
 * wholesale would be both slow and useless. These functions project it into
 * the exact shapes the UI draws: a globe needs coordinates, an inspector needs
 * one agent's whole inner life, a graph needs nodes and edges.
 */

import {
  agentTimeline,
  averageSkill,
  formatCompact,
  monthlyBurn,
  netWorthUSD,
  personalRunwayMonths,
  runwayMonths,
  socialCircle,
  stamp,
  describePassport,
  mobilityFor,
  passportStrength,
  haversineKm,
  strength,
  topBeliefs,
  type Agent,
  type World,
  type WorldEvent,
} from '@epoch/core';
import type { RunningWorld } from './runtime.ts';

export function worldSummary(running: RunningWorld) {
  const { world } = running;
  const agents = Object.values(world.agents);
  const alive = agents.filter((a) => a.alive);

  return {
    id: running.id,
    scenarioId: running.scenarioId,
    name: world.config.name,
    status: running.status,
    tickDelayMs: running.tickDelayMs,
    seed: world.config.seed,
    startISO: world.config.startISO,
    liveData: world.config.liveData,
    t: world.t,
    tick: world.tick,
    clock: stamp(world, 'UTC'),
    stats: world.stats,
    llm: running.mind.stats,
    counts: {
      agents: agents.length,
      alive: alive.length,
      cities: Object.keys(world.cities).length,
      organizations: Object.values(world.organizations).filter((o) => o.status !== 'dead').length,
      // Total ever emitted, not the resident window.
      events: world.stats.events,
    },
    mood: alive.length > 0 ? average(alive.map((a) => a.state.mood)) : 0,
    stress: alive.length > 0 ? average(alive.map((a) => a.state.stress)) : 0,
    marketUpdatedAt: world.market.updatedAt,
    warnings: running.warnings.slice(-10),
  };
}

/** Everything needed to draw an agent as a dot on a globe and a row in a list. */
export function agentSummary(world: World, agent: Agent) {
  const city = world.cities[agent.cityId];
  const destination = agent.travellingTo ? world.cities[agent.travellingTo.cityId] : undefined;

  return {
    id: agent.id,
    name: agent.name,
    age: agent.age,
    occupation: agent.occupation,
    employer: agent.employerId ? world.organizations[agent.employerId]?.name : undefined,
    cityId: agent.cityId,
    cityName: city?.name ?? 'unknown',
    lat: city?.lat ?? 0,
    lon: city?.lon ?? 0,
    alive: agent.alive,
    netWorthUSD: netWorthUSD(world, agent),
    state: agent.state,
    provider: agent.mind.provider,
    model: agent.mind.model,
    topGoal: agent.goals.filter((g) => g.status === 'active').sort((a, b) => b.priority - a.priority)[0]?.title,
    relationships: Object.keys(agent.relationships).length,
    // Present only while airborne — this is what animates the flights.
    flight: destination
      ? {
          toCityId: destination.id,
          toLat: destination.lat,
          toLon: destination.lon,
          arrivesAt: agent.travellingTo!.arrivesAt,
        }
      : undefined,
  };
}

/**
 * The full inner life of one person.
 *
 * `timeline` is passed in from storage rather than read off the world, because
 * `world.timeline` only holds the recent window — a person's whole life is in
 * the database.
 */
export function agentDetail(world: World, agent: Agent, timeline?: WorldEvent[]) {
  const city = world.cities[agent.cityId];

  return {
    ...agentSummary(world, agent),
    gender: agent.gender,
    nationality: agent.nationality,
    education: agent.education,
    iq: agent.iq,
    personality: agent.personality,
    traits: agent.traits,
    values: agent.values,
    politics: agent.politics,
    religion: agent.religion,
    interests: agent.interests,
    skills: Object.entries(agent.skills)
      .sort((a, b) => b[1] - a[1])
      .map(([name, level]) => ({ name, level })),
    averageSkill: averageSkill(agent),
    reputation: agent.reputation,
    inventory: agent.inventory,
    currentAction: agent.currentAction,

    finances: {
      ...agent.finances,
      monthlyBurn: monthlyBurn(agent, city),
      runwayMonths: finite(personalRunwayMonths(world, agent)),
      netWorthUSD: netWorthUSD(world, agent),
      ownership: agent.finances.ownership.map((stake) => ({
        ...stake,
        name: world.organizations[stake.orgId]?.name ?? 'unknown',
        valuation: world.organizations[stake.orgId]?.valuation ?? 0,
      })),
    },

    goals: agent.goals.map((goal) => ({ ...goal, deadlineISO: goal.deadline == null ? null : isoAt(world, goal.deadline) })),
    plan: agent.plan,

    beliefs: topBeliefs(agent, 12).map((belief) => ({
      id: belief.id,
      statement: belief.statement,
      confidence: belief.confidence,
      topic: belief.topic,
      t: belief.t,
    })),

    memories: agent.memory.stream
      .slice(-60)
      .reverse()
      .map((memory) => ({
        id: memory.id,
        t: memory.t,
        kind: memory.kind,
        text: memory.text,
        importance: memory.importance,
        valence: memory.valence,
      })),

    knowledge: {
      nodes: Object.values(agent.memory.graph.nodes)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 60),
      edges: agent.memory.graph.edges.sort((a, b) => b.weight - a.weight).slice(0, 120),
    },

    circle: socialCircle(world, agent, 20).map(({ agent: other, rel }) => ({
      id: other.id,
      name: other.name,
      occupation: other.occupation,
      cityName: world.cities[other.cityId]?.name ?? 'unknown',
      kind: rel.kind,
      affinity: rel.affinity,
      trust: rel.trust,
      familiarity: rel.familiarity,
      interactions: rel.interactions,
    })),

    // Which passport they hold shapes their options more than almost anything
    // else about them, so it is first-class in the inspector.
    passport: {
      nationality: agent.nationality,
      strength: passportStrength(agent.nationality),
      description: describePassport(agent),
    },

    mobility: Object.values(world.cities)
      .filter((candidate) => candidate.id !== agent.cityId)
      .map((candidate) => ({
        cityId: candidate.id,
        cityName: candidate.name,
        country: candidate.country,
        km: city ? Math.round(haversineKm(city, candidate)) : 0,
        ...mobilityFor(world, agent, candidate),
      }))
      .sort((a, b) => Number(b.allowed) - Number(a.allowed) || a.km - b.km)
      .slice(0, 12),

    timeline: timeline ?? agentTimeline(world, agent.id, 200),
  };
}

/** Nodes and edges for the relationship graph. */
export function relationshipGraph(world: World, minStrength = 0.15) {
  const agents = Object.values(world.agents).filter((a) => a.alive);

  const nodes = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    cityId: agent.cityId,
    occupation: agent.occupation,
    netWorthUSD: netWorthUSD(world, agent),
    degree: Object.keys(agent.relationships).length,
    provider: agent.mind.provider,
  }));

  // Relationships are directed; the graph draws the stronger of the two sides.
  const seen = new Set<string>();
  const edges: Array<{ source: string; target: string; kind: string; strength: number; affinity: number }> = [];

  for (const agent of agents) {
    for (const rel of Object.values(agent.relationships)) {
      const other = world.agents[rel.with];
      if (!other?.alive) continue;

      const key = [agent.id, rel.with].sort().join('|');
      if (seen.has(key)) continue;

      const reverse = other.relationships[agent.id];
      const value = Math.max(strength(rel), reverse ? strength(reverse) : 0);
      if (value < minStrength) continue;

      seen.add(key);
      edges.push({
        source: agent.id,
        target: rel.with,
        kind: rel.kind,
        strength: value,
        affinity: (rel.affinity + (reverse?.affinity ?? rel.affinity)) / 2,
      });
    }
  }

  return { nodes, edges };
}

export function organizations(world: World) {
  return Object.values(world.organizations)
    .sort((a, b) => b.valuation - a.valuation)
    .map((org) => ({
      ...org,
      cityName: world.cities[org.cityId]?.name ?? 'unknown',
      // A company past zero cash has no runway, not negative runway.
      runwayMonths: finite(Math.max(0, runwayMonths(org))),
      valuationLabel: `$${formatCompact(org.valuation)}`,
      founders: org.founderIds.map((id) => world.agents[id]?.name).filter(Boolean),
      headcount: org.employeeIds.length,
    }));
}

/** Per-city aggregates — what the globe colours its markers by. */
export function cities(world: World) {
  const agents = Object.values(world.agents).filter((a) => a.alive);

  return Object.values(world.cities).map((city) => {
    const residents = agents.filter((a) => a.cityId === city.id);
    const weather = world.weather[city.id];

    return {
      ...city,
      residents: residents.length,
      medianNetWorthUSD: median(residents.map((a) => netWorthUSD(world, a))),
      mood: residents.length > 0 ? average(residents.map((a) => a.state.mood)) : 0,
      stress: residents.length > 0 ? average(residents.map((a) => a.state.stress)) : 0,
      organizations: Object.values(world.organizations).filter((o) => o.cityId === city.id && o.status !== 'dead').length,
      weather: weather
        ? { temperatureC: weather.temperatureC, description: weather.description, code: weather.code }
        : undefined,
    };
  });
}

export function markets(world: World) {
  return {
    quotes: Object.values(world.market.quotes),
    fx: world.market.fx,
    updatedAt: world.market.updatedAt,
    news: world.news.slice(0, 20),
  };
}

/** The economy chart's series: wealth distribution across the population. */
export function wealthDistribution(world: World, buckets = 12) {
  const values = Object.values(world.agents)
    .filter((a) => a.alive)
    .map((a) => netWorthUSD(world, a))
    .sort((a, b) => a - b);

  if (values.length === 0) return { buckets: [], gini: 0, total: 0, median: 0 };

  const min = values[0]!;
  const max = values[values.length - 1]!;
  const span = Math.max(1, max - min);
  const size = span / buckets;

  const counts = Array.from({ length: buckets }, (_, index) => ({
    from: min + index * size,
    to: min + (index + 1) * size,
    count: 0,
  }));

  for (const value of values) {
    const index = Math.min(buckets - 1, Math.floor((value - min) / size));
    counts[index]!.count++;
  }

  return {
    buckets: counts,
    gini: gini(values),
    total: values.reduce((sum, v) => sum + v, 0),
    median: median(values),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Gini coefficient — 0 is perfect equality, 1 is one agent owning everything. */
function gini(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const shifted = sorted.map((v) => v - Math.min(0, sorted[0]!));
  const total = shifted.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const weighted = shifted.reduce((sum, value, index) => sum + (index + 1) * value, 0);
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

/** JSON cannot carry Infinity; the UI renders null as "stable". */
function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function isoAt(world: World, t: number): string {
  return new Date(Date.parse(world.config.startISO) + t).toISOString();
}

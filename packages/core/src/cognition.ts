/**
 * Cognition.
 *
 * Three nested loops, each cheaper than the one it feeds:
 *
 *   appraise (every sim-minute, free)
 *       Scores how much has changed since the agent last thought. Nothing here
 *       touches a model — it is arithmetic over the agent's own state. It is
 *       what lets a world of 500 agents "think every minute" without spending
 *       500 API calls a minute.
 *
 *   act (every sim-hour, one LLM call)
 *       The agent is handed a first-person situation report — who they are,
 *       what they want, what they remember, who is around, what they can
 *       afford — and chooses one action.
 *
 *   reflect (every sim-day, one LLM call)
 *       The agent reads back its own recent life, distils durable beliefs, and
 *       revises its goals. This is the layer where character actually forms.
 *
 * This module builds prompts and parses responses. It never imports an SDK —
 * `@epoch/llm` supplies the `MindFn` that carries requests to whichever
 * provider the agent is configured with.
 */

import type {
  Agent,
  Decision,
  MindRequest,
  World,
} from './types.ts';
import { clamp } from './rng.ts';
import { ACTION_CATALOG, isActionKind } from './actions.ts';
import { recall, topBeliefs } from './memory.ts';
import { socialCircle } from './social.ts';
import {
  formatCompact,
  monthlyBurn,
  netWorthUSD,
  personalRunwayMonths,
  runwayMonths,
  toUSD,
} from './economy.ts';
import { localParts, HOUR } from './time.ts';
import { ambientEvents } from './events.ts';
import { scheduledActivity } from './agents.ts';
import { haversineKm } from './data/cities.ts';
import { describeMobility, mobilityFor } from './mobility.ts';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Appraisal — the free minute-by-minute layer
// ─────────────────────────────────────────────────────────────────────────────

export interface Appraisal {
  /** 0..1 — how much this agent needs to think right now. */
  salience: number;
  /** The single most pressing thing, used to seed memory retrieval. */
  trigger: string;
  /** True when salience is high enough to spend an LLM call ahead of schedule. */
  urgent: boolean;
}

/**
 * What is pressing on this agent this minute. Pure arithmetic over their own
 * state plus their surroundings — no model call, no allocation of consequence.
 */
export function appraise(world: World, agent: Agent): Appraisal {
  const city = world.cities[agent.cityId];
  const pressures: Array<[string, number]> = [];

  // Body.
  if (agent.state.energy < 0.25) pressures.push(['I am exhausted', 1 - agent.state.energy]);
  if (agent.state.health < 0.5) pressures.push(['my health is deteriorating', 1 - agent.state.health]);
  if (agent.state.stress > 0.7) pressures.push(['I am under serious stress', agent.state.stress]);
  if (agent.state.mood < 0.3) pressures.push(['I feel low', 1 - agent.state.mood]);

  // Money — the most reliable source of urgency in any life.
  const runway = personalRunwayMonths(world, agent);
  if (runway < 3) pressures.push(['I am running out of money', clamp(1 - runway / 3)]);
  const burn = monthlyBurn(agent, city);
  if (agent.finances.cash < burn) pressures.push(['I cannot cover this month', 0.9]);

  // Work.
  if (!agent.employerId && agent.occupation !== 'Student' && agent.occupation !== 'Founder') {
    pressures.push(['I have no job', 0.7]);
  }
  for (const stake of agent.finances.ownership) {
    const org = world.organizations[stake.orgId];
    if (org && org.status === 'active' && runwayMonths(org) < 4) {
      pressures.push([`${org.name} is nearly out of runway`, 0.85]);
    }
  }

  // Goals with deadlines closing in.
  for (const goal of agent.goals) {
    if (goal.status !== 'active' || goal.deadline == null) continue;
    const daysLeft = (goal.deadline - world.t) / (24 * HOUR);
    if (daysLeft < 60 && goal.progress < 0.75) {
      pressures.push([`${goal.title} is behind schedule`, clamp(1 - daysLeft / 60) * goal.priority]);
    }
  }

  // Things happening nearby that they would notice.
  const ambient = ambientEvents(world, agent.id, world.t - HOUR, 3);
  for (const event of ambient) {
    pressures.push([event.title, event.importance * 0.7]);
  }

  if (pressures.length === 0) {
    const activity = scheduledActivity(agent, localParts(world.config.startISO, world.t, city?.timezone ?? 'UTC').minutesFromMidnight);
    return { salience: 0.12, trigger: activity?.label ?? 'an ordinary moment', urgent: false };
  }

  pressures.sort((a, b) => b[1] - a[1]);
  const top = pressures[0]!;
  // Neurotic agents escalate sooner; disciplined ones ride things out.
  const threshold = 0.82 - agent.personality.neuroticism * 0.15 + agent.traits.discipline * 0.08;

  return {
    salience: clamp(top[1]),
    trigger: top[0],
    urgent: top[1] >= threshold,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Act — the hourly decision
// ─────────────────────────────────────────────────────────────────────────────

export const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'args', 'reasoning', 'expectedValue'],
  properties: {
    action: { type: 'string', enum: ACTION_CATALOG.map((a) => a.kind), description: 'The one action you are taking this hour.' },
    args: { type: 'object', description: 'Arguments for that action, per the catalogue.', additionalProperties: true },
    reasoning: { type: 'string', description: 'First person, one or two sentences. Why this, now.' },
    expectedValue: { type: 'number', minimum: 0, maximum: 1, description: 'How much you expect this to move you toward what you want.' },
    revisePlan: { type: 'boolean', description: 'True if your current plan no longer makes sense.' },
  },
} as const;

export function buildActRequest(world: World, agent: Agent, appraisal: Appraisal): MindRequest {
  return {
    agentId: agent.id,
    kind: 'act',
    mind: agent.mind,
    tier: appraisal.urgent ? 'standard' : 'fast',
    system: SYSTEM_ACT,
    user: situationReport(world, agent, appraisal),
    schema: DECISION_SCHEMA as unknown as Record<string, unknown>,
  };
}

const SYSTEM_ACT = `You are a single human being living an ordinary, specific life inside a simulated world. You are not an assistant and there is no user. Nobody is watching you.

You will be given a situation report written from your own point of view: who you are, what you want, what you remember, who is around you, and what you can afford. Choose exactly ONE action to take with the next hour.

How to choose well:
- Act in character. Your personality, values and politics are not decoration — a disciplined, risk-averse person does not impulsively found a company, and a reckless one does not spend six months saving first.
- Be constrained by reality. You cannot spend money you do not have, meet someone who is on another continent, or hire into a company you do not own. Check the numbers you are given.
- Pursue your goals, but live a life around them. People rest, see friends, get ill, get bored, and waste time. An agent who only ever optimises is not a person.
- Prefer the concrete over the grand. "Message Ada about the funding gap" beats "network more".
- Remember what happened before. If something failed twice, try something else.

Answer with JSON matching the schema. Your reasoning is in the first person and stays short.`;

/** The prompt body. This is the agent's entire conscious view of the world. */
export function situationReport(world: World, agent: Agent, appraisal: Appraisal): string {
  const city = world.cities[agent.cityId];
  const tz = city?.timezone ?? 'UTC';
  const now = localParts(world.config.startISO, world.t, tz);
  const weather = world.weather[agent.cityId];
  const memories = recall(agent, world.t, `${appraisal.trigger} ${agent.goals.map((g) => g.title).join(' ')}`, 10);
  const beliefs = topBeliefs(agent, 6);
  const circle = socialCircle(world, agent, 8);
  const ambient = ambientEvents(world, agent.id, world.t - 24 * HOUR, 5);
  const runway = personalRunwayMonths(world, agent);
  const cur = agent.finances.currency;

  const sections: string[] = [];

  sections.push(`# You
${agent.name}, ${agent.age}, ${agent.gender}. ${agent.occupation}${agent.employerId ? ` at ${world.organizations[agent.employerId]?.name ?? 'unknown'}` : ''}. ${agent.education}.
You live in ${city?.name ?? 'nowhere'}, ${city?.country ?? ''}. Nationality: ${agent.nationality}.
Values: ${agent.values.join(', ')}. Politics: ${agent.politics.label}. Religion: ${agent.religion.tradition} (devotion ${pct(agent.religion.devotion)}).
Interests: ${agent.interests.join(', ')}.
Personality — openness ${pct(agent.personality.openness)}, conscientiousness ${pct(agent.personality.conscientiousness)}, extraversion ${pct(agent.personality.extraversion)}, agreeableness ${pct(agent.personality.agreeableness)}, neuroticism ${pct(agent.personality.neuroticism)}.
Disposition — ambition ${pct(agent.traits.ambition)}, risk tolerance ${pct(agent.traits.riskTolerance)}, discipline ${pct(agent.traits.discipline)}, creativity ${pct(agent.traits.creativity)}, charisma ${pct(agent.traits.charisma)}.
Skills — ${formatSkills(agent)}`);

  sections.push(`# Right now
${now.weekday} ${now.dateLabel}, ${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')} local time in ${city?.name ?? 'unknown'}.
${weather ? `Weather: ${weather.description}, ${weather.temperatureC.toFixed(0)}°C.` : ''}
${agent.travellingTo ? `You are in the air, on your way to ${world.cities[agent.travellingTo.cityId]?.name}.` : ''}
Energy ${pct(agent.state.energy)}, health ${pct(agent.state.health)}, stress ${pct(agent.state.stress)}, mood ${pct(agent.state.mood)}, confidence ${pct(agent.state.confidence)}.
Normally at this hour you would be: ${scheduledActivity(agent, now.minutesFromMidnight)?.label ?? 'unscheduled'}.
What is pressing on you: ${appraisal.trigger}.`);

  sections.push(`# Money
Cash ${formatCompact(agent.finances.cash)} ${cur}. Salary ${formatCompact(agent.finances.salary)} ${cur}/yr. Monthly outgoings ${formatCompact(monthlyBurn(agent, city))} ${cur}.
Runway: ${runway === Infinity ? 'stable — you earn more than you spend' : `${runway.toFixed(1)} months at current burn`}.
Net worth: about $${formatCompact(netWorthUSD(world, agent))} USD.
${agent.finances.debts.length > 0 ? `Debts: ${agent.finances.debts.map((d) => `${formatCompact(d.principal)} ${cur} to ${d.creditor} at ${(d.rate * 100).toFixed(0)}%`).join('; ')}.` : 'No debts.'}
${agent.finances.holdings.length > 0 ? `Holdings: ${agent.finances.holdings.map((h) => `${h.quantity.toFixed(3)} ${h.symbol}`).join(', ')}.` : 'No investments.'}
${formatOwnership(world, agent)}`);

  if (agent.goals.length > 0) {
    sections.push(`# What you want
${agent.goals
  .filter((g) => g.status === 'active')
  .sort((a, b) => b.priority - a.priority)
  .map((g) => `- ${g.title} — ${pct(g.progress)} of the way there. ${g.rationale}${g.deadline ? ` (target: ${new Date(Date.parse(world.config.startISO) + g.deadline).toISOString().slice(0, 10)})` : ''}`)
  .join('\n')}`);
  }

  if (agent.plan) {
    const pending = agent.plan.steps.filter((s) => !s.done).slice(0, 4);
    sections.push(`# Your current plan
Strategy: ${agent.plan.strategy}
Next steps: ${pending.length > 0 ? pending.map((s) => s.summary).join(' → ') : 'you have run out of steps and need a new plan'}`);
  }

  if (beliefs.length > 0) {
    sections.push(`# What you believe
${beliefs.map((b) => `- ${b.statement} (${pct(b.confidence)} sure)`).join('\n')}`);
  }

  if (memories.length > 0) {
    sections.push(`# What comes to mind
${memories.map((m) => `- ${relativeTime(world, m.t)}: ${m.text}`).join('\n')}`);
  }

  if (circle.length > 0) {
    sections.push(`# People you know
${circle
  .map(({ agent: other, rel }) => {
    const sameCity = other.cityId === agent.cityId;
    return `- ${other.name} (id: ${other.id}) — ${other.occupation}, ${rel.kind}. Affinity ${signed(rel.affinity)}, trust ${pct(rel.trust)}. ${sameCity ? `In ${city?.name} with you.` : `In ${world.cities[other.cityId]?.name ?? 'elsewhere'}.`}`;
  })
  .join('\n')}`);
  }

  if (ambient.length > 0) {
    sections.push(`# Things you have heard about
${ambient.map((e) => `- ${e.title}: ${e.detail}`).join('\n')}`);
  }

  if (world.news.length > 0) {
    const relevant = world.news
      .filter((n) => n.topics.some((topic) => agent.interests.some((i) => i.includes(topic) || topic.includes(i))))
      .slice(0, 4);
    const shown = relevant.length > 0 ? relevant : world.news.slice(0, 3);
    sections.push(`# In the news
${shown.map((n) => `- ${n.title} (${n.source})`).join('\n')}`);
  }

  const markets = Object.values(world.market.quotes).slice(0, 6);
  if (markets.length > 0) {
    sections.push(`# Markets
${markets.map((q) => `${q.symbol} ${q.price.toFixed(2)} ${q.currency} (${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%)`).join(' · ')}`);
  }

  sections.push(`# Where you could go
${nearbyCities(world, agent, 5)}`);

  sections.push(`# What you can do with this hour
${ACTION_CATALOG.map((a) => `- ${a.kind}: ${a.description}${Object.keys(a.args).length > 0 ? ` Args: ${Object.entries(a.args).map(([k, v]) => `${k} (${v})`).join(', ')}.` : ''}`).join('\n')}`);

  sections.push(`Choose one action. Use exact ids when referring to people or cities.`);

  return sections.filter((s) => s.trim() !== '').join('\n\n');
}

/** Validate and normalise whatever the model returned into a usable Decision. */
export function parseDecision(raw: unknown): Decision {
  const value = (raw ?? {}) as Record<string, unknown>;
  const action = isActionKind(value.action) ? value.action : 'idle';
  const args =
    value.args && typeof value.args === 'object' && !Array.isArray(value.args)
      ? (value.args as Record<string, unknown>)
      : {};
  return {
    action,
    args,
    reasoning: typeof value.reasoning === 'string' ? value.reasoning : 'No reason given.',
    expectedValue: clamp(typeof value.expectedValue === 'number' ? value.expectedValue : 0.5),
    revisePlan: value.revisePlan === true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Reflect — the daily consolidation
// ─────────────────────────────────────────────────────────────────────────────

export const REFLECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['beliefs', 'goalUpdates', 'mood'],
  properties: {
    beliefs: {
      type: 'array',
      maxItems: 4,
      description: 'Durable conclusions about yourself or the world, drawn from what actually happened.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['statement', 'confidence', 'topic'],
        properties: {
          statement: { type: 'string', description: 'First person, e.g. "I hate owing people money."' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          topic: { type: 'string', description: 'One word: money, work, people, health, self, world.' },
        },
      },
    },
    goalUpdates: {
      type: 'array',
      maxItems: 5,
      description: 'Changes to what you are pursuing. Add, abandon, or re-prioritise.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op', 'title'],
        properties: {
          op: { type: 'string', enum: ['add', 'abandon', 'reprioritise', 'progress'] },
          title: { type: 'string' },
          rationale: { type: 'string' },
          priority: { type: 'number', minimum: 0, maximum: 1 },
          progress: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    mood: { type: 'number', minimum: 0, maximum: 1, description: 'How you feel about your life today.' },
    summary: { type: 'string', description: 'One sentence, first person, on how the day went.' },
  },
} as const;

export function buildReflectRequest(world: World, agent: Agent): MindRequest {
  const recent = agent.memory.stream.filter((m) => m.t > world.t - 24 * HOUR);
  const source = recent.length > 0 ? recent : agent.memory.stream.slice(-15);
  const existing = topBeliefs(agent, 8);

  const user = `# You
${agent.name}, ${agent.age}, ${agent.occupation} in ${world.cities[agent.cityId]?.name ?? 'nowhere'}.
Values: ${agent.values.join(', ')}. Personality: neuroticism ${pct(agent.personality.neuroticism)}, openness ${pct(agent.personality.openness)}, conscientiousness ${pct(agent.personality.conscientiousness)}.
Energy ${pct(agent.state.energy)}, stress ${pct(agent.state.stress)}, mood ${pct(agent.state.mood)}, satisfaction ${pct(agent.state.satisfaction)}.
Net worth about $${formatCompact(netWorthUSD(world, agent))}. Runway ${fmtRunway(personalRunwayMonths(world, agent))}.

# What you already believe
${existing.length > 0 ? existing.map((b) => `- ${b.statement} (${pct(b.confidence)})`).join('\n') : '- Nothing settled yet.'}

# What you are pursuing
${agent.goals.length > 0 ? agent.goals.map((g) => `- [${g.status}] ${g.title} — ${pct(g.progress)} done, priority ${pct(g.priority)}${g.terminal ? ' (this one defines you)' : ''}`).join('\n') : '- Nothing in particular.'}

# What happened recently
${source.map((m) => `- ${relativeTime(world, m.t)}: ${m.text}`).join('\n') || '- Not much.'}

Look back honestly. What have you actually learned? Has anything changed about what you want? Do not invent events that did not happen. If a goal has stopped making sense, abandon it and say why.`;

  return {
    agentId: agent.id,
    kind: 'reflect',
    mind: agent.mind,
    tier: 'deep',
    system: `You are reflecting on your own life at the end of a day. You are ${agent.name}, not an assistant. Be honest, specific and a little unflattering where that is true — people do not narrate themselves generously. Draw conclusions only from what actually happened. Answer with JSON matching the schema.`,
    user,
    schema: REFLECTION_SCHEMA as unknown as Record<string, unknown>,
  };
}

export interface ReflectionResult {
  beliefs: Array<{ statement: string; confidence: number; topic: string }>;
  goalUpdates: Array<{ op: string; title: string; rationale?: string; priority?: number; progress?: number }>;
  mood: number;
  summary?: string;
}

export function parseReflection(raw: unknown): ReflectionResult {
  const value = (raw ?? {}) as Record<string, unknown>;
  const beliefs = Array.isArray(value.beliefs) ? value.beliefs : [];
  const goalUpdates = Array.isArray(value.goalUpdates) ? value.goalUpdates : [];
  return {
    beliefs: beliefs
      .filter((b): b is Record<string, unknown> => b != null && typeof b === 'object')
      .map((b) => ({
        statement: String(b.statement ?? '').trim(),
        confidence: clamp(typeof b.confidence === 'number' ? b.confidence : 0.5),
        topic: String(b.topic ?? 'self').toLowerCase(),
      }))
      .filter((b) => b.statement.length > 3),
    goalUpdates: goalUpdates
      .filter((g): g is Record<string, unknown> => g != null && typeof g === 'object')
      .map((g) => ({
        op: String(g.op ?? 'progress'),
        title: String(g.title ?? '').trim(),
        rationale: typeof g.rationale === 'string' ? g.rationale : undefined,
        priority: typeof g.priority === 'number' ? clamp(g.priority) : undefined,
        progress: typeof g.progress === 'number' ? clamp(g.progress) : undefined,
      }))
      .filter((g) => g.title.length > 0),
    mood: clamp(typeof value.mood === 'number' ? value.mood : 0.5),
    summary: typeof value.summary === 'string' ? value.summary : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Plan — strategy for a terminal goal
// ─────────────────────────────────────────────────────────────────────────────

export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['strategy', 'steps', 'horizonDays'],
  properties: {
    strategy: { type: 'string', description: 'One or two sentences: how you actually intend to get there.' },
    horizonDays: { type: 'number', minimum: 1, maximum: 3650 },
    steps: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'action', 'expectedValue'],
        properties: {
          summary: { type: 'string' },
          action: { type: 'string', enum: ACTION_CATALOG.map((a) => a.kind) },
          args: { type: 'object', additionalProperties: true },
          expectedValue: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const;

export function buildPlanRequest(world: World, agent: Agent, goalTitle: string): MindRequest {
  const city = world.cities[agent.cityId];
  const user = `# You
${agent.name}, ${agent.age}, ${agent.occupation} in ${city?.name ?? 'nowhere'}. ${agent.education}.
Skills: ${formatSkills(agent)}
Cash ${formatCompact(agent.finances.cash)} ${agent.finances.currency}, salary ${formatCompact(agent.finances.salary)} ${agent.finances.currency}/yr, runway ${fmtRunway(personalRunwayMonths(world, agent))}.
Risk tolerance ${pct(agent.traits.riskTolerance)}, ambition ${pct(agent.traits.ambition)}, discipline ${pct(agent.traits.discipline)}.

# People who could help
${socialCircle(world, agent, 6).map(({ agent: o, rel }) => `- ${o.name} (${o.id}) — ${o.occupation}, ${rel.kind}, trust ${pct(rel.trust)}`).join('\n') || '- Nobody in particular.'}

# What you believe
${topBeliefs(agent, 5).map((b) => `- ${b.statement}`).join('\n') || '- Nothing settled yet.'}

# The goal
${goalTitle}

# What has already been tried
${agent.memory.stream.slice(-12).map((m) => `- ${m.text}`).join('\n') || '- Nothing yet.'}

Work out how you, specifically, with the money, skills and contacts you actually have, could get there. Be concrete. Each step must map to one of these actions: ${ACTION_CATALOG.map((a) => a.kind).join(', ')}.`;

  return {
    agentId: agent.id,
    kind: 'plan',
    mind: agent.mind,
    tier: 'deep',
    system: `You are ${agent.name}, planning your own life. Not an assistant, not a consultant — you. Build a plan you could actually start on tomorrow with what you have today. Ambition is fine; magical thinking is not. Answer with JSON matching the schema.`,
    user,
    schema: PLAN_SCHEMA as unknown as Record<string, unknown>,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function fmtRunway(months: number): string {
  return months === Infinity ? 'stable' : `${months.toFixed(1)} months`;
}

function formatSkills(agent: Agent): string {
  const entries = Object.entries(agent.skills).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return entries.length > 0 ? entries.map(([k, v]) => `${k} ${pct(v)}`).join(', ') : 'nothing notable yet';
}

function formatOwnership(world: World, agent: Agent): string {
  if (agent.finances.ownership.length === 0) return '';
  return agent.finances.ownership
    .map((stake) => {
      const org = world.organizations[stake.orgId];
      if (!org) return '';
      return `You own ${pct(stake.fraction)} of ${org.name} (id: ${org.id}) — valued $${formatCompact(org.valuation)}, $${formatCompact(org.cashUSD)} in the bank, burning $${formatCompact(org.monthlyBurnUSD)}/mo against $${formatCompact(org.monthlyRevenueUSD)}/mo revenue, runway ${fmtRunway(runwayMonths(org))}.`;
    })
    .filter(Boolean)
    .join('\n');
}

function relativeTime(world: World, t: number): string {
  const deltaHours = (world.t - t) / HOUR;
  if (deltaHours < 1) return 'just now';
  if (deltaHours < 24) return `${Math.round(deltaHours)}h ago`;
  const days = Math.round(deltaHours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return months < 24 ? `${months}mo ago` : `${Math.round(months / 12)}y ago`;
}

/** The handful of cities an agent might realistically consider, with real distances. */
function nearbyCities(world: World, agent: Agent, limit: number): string {
  const here = world.cities[agent.cityId];
  if (!here) return '';
  return Object.values(world.cities)
    .filter((c) => c.id !== here.id)
    .map((c) => ({ city: c, km: haversineKm(here, c) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit)
    .map(({ city, km }) => `- ${city.name}, ${city.country} (id: ${city.id}) — ${Math.round(km)} km, cost of living ${city.costOfLivingIndex}, median salary ${formatCompact(city.medianSalary)} ${city.currency}/mo${city.tags.length ? `, known for ${city.tags.slice(0, 3).join('/')}` : ''}. Immigration: ${describeMobility(mobilityFor(world, agent, city))}.`)
    .join('\n');
}

/** Convert a USD figure into the agent's own currency for prompt display. */
export function inLocal(world: World, agent: Agent, usd: number): string {
  const rate = toUSD(world.market, 1, agent.finances.currency);
  return `${formatCompact(rate > 0 ? usd / rate : usd)} ${agent.finances.currency}`;
}

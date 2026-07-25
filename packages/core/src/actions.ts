/**
 * The action space.
 *
 * This is the complete list of things an agent can do with an hour of its life.
 * The catalogue is also what gets shown to the language model, so the
 * descriptions here are load-bearing: they are the agent's understanding of its
 * own affordances.
 *
 * Every action resolves to an `ActionOutcome` — a narrative summary plus an
 * emotional charge — which is then written into memory and the world timeline.
 */

import type {
  ActionKind,
  ActionOutcome,
  Agent,
  Organization,
  World,
} from './types.ts';
import { Rng, clamp } from './rng.ts';
import { HOUR } from './time.ts';
import { emit } from './events.ts';
import { remember, learnFact } from './memory.ts';
import { interact, propagateReputation, plausibleEncounters, ensureRelationship } from './social.ts';
import {
  attemptRaise,
  averageSkill,
  buyAsset,
  foundOrganization,
  formatCompact,
  fromUSD,
  hireInto,
  sellAsset,
  toUSD,
} from './economy.ts';
import { haversineKm, flightHours, flightCostUSD } from './data/cities.ts';

export interface ActionSpec {
  kind: ActionKind;
  /** Shown to the model. Written in the second person, as an affordance. */
  description: string;
  /** Argument documentation, also shown to the model. */
  args: Record<string, string>;
}

export const ACTION_CATALOG: ActionSpec[] = [
  { kind: 'work', description: 'Do your job for an hour. Builds skill, earns your salary, drains energy.', args: { focus: 'optional: what you worked on' } },
  { kind: 'study', description: 'Deliberately learn a skill. Slower payoff than working, but compounds.', args: { skill: 'skill name, e.g. "machine-learning"' } },
  { kind: 'apply_for_job', description: 'Apply for a role. Success depends on your skills, reputation and who you know.', args: { orgId: 'optional target organisation id', role: 'the role you want' } },
  { kind: 'start_business', description: 'Found a company. Costs a chunk of your savings and your job security.', args: { name: 'company name', sector: 'e.g. technology', description: 'one line on what it does' } },
  { kind: 'fundraise', description: 'Pitch investors for capital. Only possible if you own a company.', args: { amountUSD: 'how much you are asking for, in USD' } },
  { kind: 'hire', description: 'Recruit someone into your company. They must be someone you know.', args: { agentId: 'who to hire', salaryUSD: 'annual salary offer in USD' } },
  { kind: 'invest', description: 'Buy a financial asset at the live market price.', args: { symbol: 'ticker or crypto id, e.g. AAPL or bitcoin', amountUSD: 'how much to deploy' } },
  { kind: 'sell_asset', description: 'Liquidate part or all of a position.', args: { symbol: 'what to sell', fraction: '0..1, how much of the position' } },
  { kind: 'message', description: 'Email or text someone. Works at any distance.', args: { agentId: 'who to contact', content: 'what you say' } },
  { kind: 'call', description: 'Phone or video call someone. Higher bandwidth than a message.', args: { agentId: 'who to call', content: 'what you want to discuss' } },
  { kind: 'meet', description: 'Meet someone in person. Requires you both to be in the same city.', args: { agentId: 'who to meet', purpose: 'why you are meeting' } },
  { kind: 'socialise', description: 'Go out. You will run into whoever is around — sometimes strangers.', args: { where: 'optional: the kind of place' } },
  { kind: 'publish', description: 'Put something into the world: a tweet, a blog post, a paper, a podcast. Builds reputation.', args: { medium: 'tweet | blog | paper | podcast | talk', topic: 'what it is about', content: 'the substance of it' } },
  { kind: 'research', description: 'Dig into an open problem. Occasionally produces a genuine breakthrough.', args: { topic: 'what you are investigating' } },
  { kind: 'travel', description: 'Fly to another city for a while. Costs money and time.', args: { cityId: 'destination city id', purpose: 'why you are going' } },
  { kind: 'relocate', description: 'Move your whole life to another city. Big, expensive, irreversible-feeling.', args: { cityId: 'destination city id', reason: 'why you are moving' } },
  { kind: 'exercise', description: 'Train. Improves health and energy over time.', args: {} },
  { kind: 'rest', description: 'Sleep or genuinely switch off. Restores energy, lowers stress.', args: {} },
  { kind: 'seek_medical_care', description: 'See a doctor. Costs money, restores health.', args: { concern: 'what is wrong' } },
  { kind: 'idle', description: 'Do nothing much. Sometimes the honest answer.', args: {} },
];

export const ACTION_KINDS = ACTION_CATALOG.map((a) => a.kind);

export function isActionKind(value: unknown): value is ActionKind {
  return typeof value === 'string' && (ACTION_KINDS as string[]).includes(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution
// ─────────────────────────────────────────────────────────────────────────────

export function executeAction(
  world: World,
  rng: Rng,
  agent: Agent,
  action: ActionKind,
  args: Record<string, unknown>,
  reasoning: string,
): ActionOutcome {
  const handler = HANDLERS[action] ?? HANDLERS.idle!;
  const outcome = handler(world, rng, agent, args, reasoning);

  remember(agent, world.t, {
    kind: 'action',
    text: outcome.summary,
    importance: outcome.importance,
    valence: outcome.valence,
    participants: [agent.id, ...(outcome.witnesses ?? [])],
    cityId: agent.cityId,
  });

  if (outcome.importance >= 0.55) {
    emit(world, {
      category: categoryFor(action),
      title: `${agent.name}: ${titleFor(action)}`,
      detail: outcome.summary,
      agentIds: [agent.id, ...(outcome.witnesses ?? [])],
      cityId: agent.cityId,
      importance: outcome.importance,
      meta: { action, reasoning },
    });
  }

  return outcome;
}

type Handler = (
  world: World,
  rng: Rng,
  agent: Agent,
  args: Record<string, unknown>,
  reasoning: string,
) => ActionOutcome;

const HANDLERS: Partial<Record<ActionKind, Handler>> = {
  // ── Career ────────────────────────────────────────────────────────────────
  work(world, rng, agent, args) {
    const focus = str(args.focus) || agent.occupation;
    const effort = agent.state.energy * (0.5 + agent.traits.discipline * 0.5);

    agent.state.energy = clamp(agent.state.energy - 0.09 - agent.state.stress * 0.04);
    agent.state.stress = clamp(agent.state.stress + 0.02 - agent.traits.discipline * 0.01);

    // Skills improve with diminishing returns.
    const primary = Object.keys(agent.skills)[0] ?? 'general';
    const current = agent.skills[primary] ?? 0.2;
    agent.skills[primary] = clamp(current + (1 - current) * 0.004 * effort);

    const org = agent.employerId ? world.organizations[agent.employerId] : undefined;
    if (org && org.status === 'active') {
      org.monthlyRevenueUSD += org.monthlyRevenueUSD * 0.001 * effort;
    }

    // Occasionally the work is genuinely notable.
    if (rng.bool(0.03 * effort * (1 + averageSkill(agent)))) {
      propagateReputation(world, agent, sectorOf(agent), 0.05);
      return {
        ok: true,
        summary: `I had a genuinely good day working on ${focus} — shipped something I'm proud of.`,
        importance: 0.55,
        valence: 0.6,
      };
    }

    return {
      ok: true,
      summary: `Worked on ${focus}.`,
      importance: 0.15,
      valence: agent.state.stress > 0.7 ? -0.2 : 0.1,
    };
  },

  study(world, rng, agent, args) {
    const skill = (str(args.skill) || 'learning').toLowerCase().replace(/\s+/g, '-');
    const aptitude = 0.4 + (agent.iq - 100) / 200 + agent.traits.discipline * 0.3;
    const current = agent.skills[skill] ?? 0;
    const gain = (1 - current) * 0.012 * clamp(aptitude, 0.1, 1.4) * agent.state.energy;

    agent.skills[skill] = clamp(current + gain);
    agent.state.energy = clamp(agent.state.energy - 0.06);

    learnFact(
      agent.memory.graph,
      { id: agent.id, label: agent.name, type: 'person' },
      'studies',
      { id: `skill:${skill}`, label: skill, type: 'skill' },
      0.15,
    );

    const crossedThreshold = current < 0.7 && agent.skills[skill]! >= 0.7;
    void rng;
    return {
      ok: true,
      summary: crossedThreshold
        ? `I've reached the point with ${skill} where I actually know what I'm doing.`
        : `Studied ${skill} (now ${(agent.skills[skill]! * 100).toFixed(0)}%).`,
      importance: crossedThreshold ? 0.6 : 0.2,
      valence: 0.25,
    };
  },

  apply_for_job(world, rng, agent, args) {
    // Falling back to the agent's current occupation keeps a successful move
    // from renaming their job to a placeholder.
    const role = str(args.role) || agent.occupation;
    const targetOrg = str(args.orgId) ? world.organizations[str(args.orgId)!] : undefined;

    const referral = targetOrg
      ? targetOrg.employeeIds.some((id) => (agent.relationships[id]?.affinity ?? 0) > 0.3)
      : false;
    const chance = clamp(
      averageSkill(agent) * 0.5 + agent.reputation.overall * 0.25 + (referral ? 0.2 : 0) + agent.traits.charisma * 0.1,
      0.03,
      0.9,
    );

    agent.state.energy = clamp(agent.state.energy - 0.04);

    if (!rng.bool(chance)) {
      agent.state.confidence = clamp(agent.state.confidence - 0.04);
      return { ok: false, summary: `Applied for ${role}${targetOrg ? ` at ${targetOrg.name}` : ''} and got rejected.`, importance: 0.35, valence: -0.45 };
    }

    const city = world.cities[agent.cityId];
    const oldSalary = agent.finances.salary;
    if (targetOrg) {
      const offerUSD = toUSD(world.market, oldSalary, agent.finances.currency) * rng.float(1.05, 1.45) || 60000;
      if (!hireInto(world, targetOrg, agent, offerUSD)) {
        return { ok: false, summary: `${targetOrg.name} wanted me but couldn't afford the offer.`, importance: 0.35, valence: -0.3 };
      }
    } else {
      agent.finances.salary = Math.round((city?.medianSalary ?? 3000) * 12 * rng.float(1.0, 1.9));
      agent.occupation = role;
    }

    agent.state.confidence = clamp(agent.state.confidence + 0.12);
    agent.state.satisfaction = clamp(agent.state.satisfaction + 0.1);
    return {
      ok: true,
      summary: `Got the job: ${role}${targetOrg ? ` at ${targetOrg.name}` : ''}. Salary went from ${formatCompact(oldSalary)} to ${formatCompact(agent.finances.salary)} ${agent.finances.currency}.`,
      importance: 0.8,
      valence: 0.8,
    };
  },

  start_business(world, rng, agent, args) {
    const name = str(args.name) || `${agent.name.split(' ')[0]} Labs`;
    const sector = str(args.sector) || 'technology';
    const description = str(args.description) || 'Still figuring out exactly what this is.';

    const org = foundOrganization(world, agent, { name, sector, description });
    org.monthlyBurnUSD = rng.float(1500, 9000);
    agent.state.stress = clamp(agent.state.stress + 0.2);
    agent.state.confidence = clamp(agent.state.confidence + 0.15);
    agent.skills['fundraising'] = clamp((agent.skills['fundraising'] ?? 0) + 0.05);

    learnFact(
      agent.memory.graph,
      { id: agent.id, label: agent.name, type: 'person' },
      'founded',
      { id: org.id, label: org.name, type: 'org' },
      0.9,
    );

    return {
      ok: true,
      summary: `I founded ${name}. ${description} I've put my savings into it and I'm terrified and thrilled in equal measure.`,
      importance: 0.95,
      valence: 0.7,
    };
  },

  fundraise(world, rng, agent, args) {
    const org = ownedOrg(world, agent);
    if (!org) return { ok: false, summary: `Tried to raise money but I don't actually have a company to raise for.`, importance: 0.2, valence: -0.2 };

    const ask = num(args.amountUSD) ?? 500_000;
    const result = attemptRaise(world, rng, agent, org, ask);
    agent.skills['fundraising'] = clamp((agent.skills['fundraising'] ?? 0) + 0.02);

    return {
      ok: result.ok,
      summary: result.ok
        ? `${result.message} ${org.name} has runway again.`
        : `Pitched ${formatCompact(ask)} for ${org.name}. ${result.message}`,
      importance: result.ok ? 0.9 : 0.5,
      valence: result.ok ? 0.85 : -0.55,
    };
  },

  hire(world, rng, agent, args) {
    const org = ownedOrg(world, agent);
    if (!org) return { ok: false, summary: `I have nobody to hire into — no company.`, importance: 0.15, valence: -0.1 };

    const candidate = world.agents[str(args.agentId) ?? ''];
    if (!candidate || !candidate.alive) return { ok: false, summary: `Tried to hire someone who isn't around.`, importance: 0.15, valence: -0.1 };

    const salaryUSD = num(args.salaryUSD) ?? 70_000;
    const rel = candidate.relationships[agent.id];
    const willing = clamp(
      0.25 + (rel?.trust ?? 0) * 0.4 + agent.traits.charisma * 0.2 + org.valuation / 1e8 - candidate.state.satisfaction * 0.3,
      0.05,
      0.95,
    );

    if (!rng.bool(willing)) {
      return { ok: false, summary: `${candidate.name} turned down my offer to join ${org.name}.`, importance: 0.4, valence: -0.4, witnesses: [candidate.id] };
    }
    if (!hireInto(world, org, candidate, salaryUSD)) {
      return { ok: false, summary: `${candidate.name} said yes but ${org.name} can't afford them yet.`, importance: 0.4, valence: -0.5, witnesses: [candidate.id] };
    }

    interact(world, rng, agent, candidate, {
      quality: 0.6,
      summary: `${candidate.name} joined ${org.name} at $${formatCompact(salaryUSD)}/yr.`,
      context: 'work',
      importance: 0.7,
    });

    return { ok: true, summary: `Hired ${candidate.name} into ${org.name}.`, importance: 0.7, valence: 0.6, witnesses: [candidate.id] };
  },

  // ── Money ─────────────────────────────────────────────────────────────────
  invest(world, rng, agent, args) {
    const symbol = str(args.symbol) || 'SPY';
    const amount = num(args.amountUSD) ?? toUSD(world.market, agent.finances.cash, agent.finances.currency) * 0.15;
    const result = buyAsset(world, agent, symbol, amount);
    void rng;
    return {
      ok: result.ok,
      summary: result.ok ? result.message : `Wanted to buy ${symbol} but couldn't: ${result.message}`,
      importance: result.ok ? 0.4 : 0.2,
      valence: result.ok ? 0.2 : -0.25,
    };
  },

  sell_asset(world, _rng, agent, args) {
    const symbol = str(args.symbol) || agent.finances.holdings[0]?.symbol || '';
    const fraction = num(args.fraction) ?? 1;
    const result = sellAsset(world, agent, symbol, fraction);
    return {
      ok: result.ok,
      summary: result.message,
      importance: result.ok ? 0.4 : 0.15,
      valence: result.ok ? 0.15 : -0.15,
    };
  },

  // ── Communication ─────────────────────────────────────────────────────────
  message(world, rng, agent, args) {
    return communicate(world, rng, agent, args, 'message');
  },
  call(world, rng, agent, args) {
    return communicate(world, rng, agent, args, 'call');
  },

  meet(world, rng, agent, args) {
    const other = world.agents[str(args.agentId) ?? ''];
    if (!other || !other.alive) return { ok: false, summary: `Tried to meet someone who isn't available.`, importance: 0.15, valence: -0.1 };
    if (other.cityId !== agent.cityId) {
      return { ok: false, summary: `Wanted to meet ${other.name} but they're in ${world.cities[other.cityId]?.name ?? 'another city'} and I'm not.`, importance: 0.2, valence: -0.25 };
    }

    const purpose = str(args.purpose) || 'catch up';
    const chemistry = affinityDelta(agent, other, rng);
    agent.state.energy = clamp(agent.state.energy - 0.05);

    interact(world, rng, agent, other, {
      quality: chemistry,
      summary: `${agent.name} met ${other.name} in ${world.cities[agent.cityId]?.name ?? 'town'} to ${purpose}.`,
      context: 'social',
      importance: 0.45 + Math.abs(chemistry) * 0.25,
    });

    return {
      ok: true,
      summary: chemistry > 0.3
        ? `Met ${other.name} to ${purpose}. It went really well.`
        : chemistry < -0.3
          ? `Met ${other.name} to ${purpose}. It was tense and I left annoyed.`
          : `Met ${other.name} to ${purpose}.`,
      importance: 0.45,
      valence: chemistry,
      witnesses: [other.id],
    };
  },

  socialise(world, rng, agent, args) {
    const where = str(args.where) || 'out';
    const [other] = plausibleEncounters(world, agent, rng, 1);
    agent.state.energy = clamp(agent.state.energy - 0.04 + agent.personality.extraversion * 0.03);
    agent.state.stress = clamp(agent.state.stress - 0.05 * agent.personality.extraversion);
    agent.state.mood = clamp(agent.state.mood + 0.04);

    if (!other) {
      return { ok: true, summary: `Went ${where} alone. Quiet night.`, importance: 0.15, valence: 0.05 };
    }

    const wasStranger = !agent.relationships[other.id];
    const chemistry = affinityDelta(agent, other, rng);
    interact(world, rng, agent, other, {
      quality: chemistry,
      summary: wasStranger
        ? `${agent.name} met ${other.name} for the first time, ${where} in ${world.cities[agent.cityId]?.name ?? 'town'}.`
        : `${agent.name} and ${other.name} spent the evening together.`,
      context: 'social',
      importance: wasStranger ? 0.5 : 0.3,
    });

    return {
      ok: true,
      summary: wasStranger
        ? `Went ${where} and met ${other.name} (${other.occupation}) for the first time.`
        : `Spent time with ${other.name}.`,
      importance: wasStranger ? 0.45 : 0.25,
      valence: chemistry,
      witnesses: [other.id],
    };
  },

  publish(world, rng, agent, args) {
    const medium = str(args.medium) || 'blog';
    const topic = str(args.topic) || 'something I have been thinking about';
    const quality = clamp(
      agent.traits.creativity * 0.35 + averageSkill(agent) * 0.35 + (agent.skills['writing'] ?? 0) * 0.3 + rng.gaussian(0, 0.12),
    );

    // Reach is reputation-weighted and heavy-tailed: most things sink.
    const viral = rng.bool(quality * 0.12);
    const reach = viral ? rng.float(50_000, 3_000_000) : rng.float(20, 4000) * (1 + agent.reputation.overall * 12);
    const domain = topic.split(/\s+/)[0]?.toLowerCase() ?? 'general';

    propagateReputation(world, agent, domain, viral ? 0.22 : quality * 0.05);
    agent.state.energy = clamp(agent.state.energy - 0.05);
    if (viral) agent.state.confidence = clamp(agent.state.confidence + 0.12);

    emit(world, {
      category: 'social',
      title: viral ? `${agent.name}'s ${medium} on ${topic} went viral` : `${agent.name} published a ${medium}`,
      detail: `${topic} — reached roughly ${formatCompact(reach)} people.`,
      agentIds: [agent.id],
      cityId: agent.cityId,
      importance: viral ? 0.85 : 0.3,
    });

    return {
      ok: true,
      summary: viral
        ? `My ${medium} about ${topic} blew up — around ${formatCompact(reach)} people saw it. My phone hasn't stopped.`
        : `Published a ${medium} about ${topic}. About ${formatCompact(reach)} people read it.`,
      importance: viral ? 0.85 : 0.25,
      valence: viral ? 0.8 : 0.15,
    };
  },

  research(world, rng, agent, args) {
    const topic = str(args.topic) || 'an open problem';
    const capability = clamp((agent.iq - 90) / 60) * 0.5 + averageSkill(agent) * 0.3 + agent.traits.creativity * 0.2;

    agent.state.energy = clamp(agent.state.energy - 0.08);
    agent.skills['research'] = clamp((agent.skills['research'] ?? 0.1) + 0.008);

    learnFact(
      agent.memory.graph,
      { id: agent.id, label: agent.name, type: 'person' },
      'researches',
      { id: `concept:${topic.toLowerCase().slice(0, 40)}`, label: topic, type: 'concept' },
      0.25,
    );

    if (rng.bool(capability * 0.02)) {
      propagateReputation(world, agent, 'research', 0.3);
      emit(world, {
        category: 'world',
        title: `Breakthrough: ${agent.name} on ${topic}`,
        detail: `A genuine result. The field will have to respond to this.`,
        agentIds: [agent.id],
        cityId: agent.cityId,
        importance: 0.95,
      });
      return { ok: true, summary: `I think I've actually got something on ${topic}. This could be real.`, importance: 0.95, valence: 0.9 };
    }

    return { ok: true, summary: `Spent the day on ${topic}. Slow progress.`, importance: 0.2, valence: 0.1 };
  },

  // ── Movement ──────────────────────────────────────────────────────────────
  travel(world, rng, agent, args) {
    const destination = world.cities[str(args.cityId) ?? ''];
    if (!destination) return { ok: false, summary: `Tried to travel somewhere that doesn't exist.`, importance: 0.1, valence: -0.1 };
    if (destination.id === agent.cityId) return { ok: false, summary: `I'm already here.`, importance: 0.05, valence: 0 };

    const origin = world.cities[agent.cityId];
    if (!origin) return { ok: false, summary: `Lost track of where I am.`, importance: 0.1, valence: -0.1 };

    const km = haversineKm(origin, destination);
    const costUSD = flightCostUSD(km);
    const cashUSD = toUSD(world.market, agent.finances.cash, agent.finances.currency);
    if (cashUSD < costUSD) {
      return { ok: false, summary: `Wanted to fly to ${destination.name} but I can't afford the $${costUSD} fare.`, importance: 0.35, valence: -0.5 };
    }

    agent.finances.cash -= fromUSD(world.market, costUSD, agent.finances.currency);
    agent.travellingTo = { cityId: destination.id, arrivesAt: world.t + flightHours(km) * HOUR };
    agent.state.energy = clamp(agent.state.energy - 0.12);

    emit(world, {
      category: 'travel',
      title: `${agent.name} flew to ${destination.name}`,
      detail: `${origin.name} → ${destination.name}, ${Math.round(km)} km. ${str(args.purpose) ?? ''}`.trim(),
      agentIds: [agent.id],
      cityId: destination.id,
      importance: 0.5,
      meta: { from: origin.id, to: destination.id, km },
    });
    void rng;

    return {
      ok: true,
      summary: `Flying from ${origin.name} to ${destination.name} — ${Math.round(km)} km, $${costUSD}. ${str(args.purpose) ?? ''}`.trim(),
      importance: 0.5,
      valence: 0.3,
    };
  },

  relocate(world, rng, agent, args) {
    const destination = world.cities[str(args.cityId) ?? ''];
    if (!destination) return { ok: false, summary: `Considered moving somewhere that doesn't exist.`, importance: 0.1, valence: -0.1 };
    if (destination.id === agent.cityId) return { ok: false, summary: `I already live here.`, importance: 0.05, valence: 0 };

    const origin = world.cities[agent.cityId];
    const moveCostUSD = 2500 + haversineKm(origin ?? destination, destination) * 0.4;
    const cashUSD = toUSD(world.market, agent.finances.cash, agent.finances.currency);
    if (cashUSD < moveCostUSD) {
      return { ok: false, summary: `I want out of ${origin?.name ?? 'here'}, but moving to ${destination.name} costs about $${formatCompact(moveCostUSD)} and I don't have it.`, importance: 0.5, valence: -0.6 };
    }

    // Convert their savings into the new currency and reprice their salary.
    const remainingUSD = cashUSD - moveCostUSD;
    agent.finances.cash = fromUSD(world.market, remainingUSD, destination.currency);
    agent.finances.currency = destination.currency;
    agent.finances.salary = Math.round(
      (destination.medianSalary * 12) * clamp(averageSkill(agent) * 2, 0.5, 2.6) * rng.float(0.85, 1.2),
    );
    agent.finances.monthlyExpenses = Math.round(destination.medianSalary * 0.45);
    agent.cityId = destination.id;
    agent.travellingTo = undefined;
    agent.state.stress = clamp(agent.state.stress + 0.15);
    agent.state.satisfaction = clamp(agent.state.satisfaction + 0.08);

    learnFact(
      agent.memory.graph,
      { id: agent.id, label: agent.name, type: 'person' },
      'lives-in',
      { id: destination.id, label: destination.name, type: 'place' },
      0.8,
    );

    emit(world, {
      category: 'life',
      title: `${agent.name} moved to ${destination.name}`,
      detail: str(args.reason) || `Left ${origin?.name ?? 'home'} for good.`,
      agentIds: [agent.id],
      cityId: destination.id,
      importance: 0.85,
    });

    return {
      ok: true,
      summary: `I moved to ${destination.name}. ${str(args.reason) ?? 'Time for something different.'} Everything I own is in two bags.`,
      importance: 0.9,
      valence: 0.5,
    };
  },

  // ── Body ──────────────────────────────────────────────────────────────────
  exercise(_world, rng, agent) {
    agent.state.health = clamp(agent.state.health + 0.012);
    agent.state.energy = clamp(agent.state.energy - 0.03);
    agent.state.stress = clamp(agent.state.stress - 0.07);
    agent.state.mood = clamp(agent.state.mood + 0.05);
    void rng;
    return { ok: true, summary: `Trained. Head feels clearer.`, importance: 0.12, valence: 0.35 };
  },

  rest(_world, _rng, agent) {
    agent.state.energy = clamp(agent.state.energy + 0.14);
    agent.state.stress = clamp(agent.state.stress - 0.05);
    agent.state.health = clamp(agent.state.health + 0.002);
    return { ok: true, summary: `Rested.`, importance: 0.08, valence: 0.15 };
  },

  seek_medical_care(world, rng, agent, args) {
    const concern = str(args.concern) || 'a check-up';
    const costUSD = rng.float(60, 900);
    const cashUSD = toUSD(world.market, agent.finances.cash, agent.finances.currency);

    if (cashUSD < costUSD) {
      agent.state.stress = clamp(agent.state.stress + 0.1);
      return { ok: false, summary: `I need to see someone about ${concern} but I can't afford it right now.`, importance: 0.6, valence: -0.7 };
    }

    agent.finances.cash -= fromUSD(world.market, costUSD, agent.finances.currency);
    const recovered = clamp(rng.float(0.05, 0.2));
    agent.state.health = clamp(agent.state.health + recovered);
    agent.state.stress = clamp(agent.state.stress - 0.06);

    return {
      ok: true,
      summary: `Saw a doctor about ${concern}. Cost $${costUSD.toFixed(0)}. Feeling better.`,
      importance: 0.4,
      valence: 0.3,
    };
  },

  idle(_world, _rng, agent) {
    agent.state.energy = clamp(agent.state.energy + 0.04);
    return { ok: true, summary: `Nothing much happened.`, importance: 0.05, valence: 0 };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function communicate(
  world: World,
  rng: Rng,
  agent: Agent,
  args: Record<string, unknown>,
  mode: 'message' | 'call',
): ActionOutcome {
  const other = world.agents[str(args.agentId) ?? ''];
  if (!other || !other.alive) {
    return { ok: false, summary: `Tried to reach someone who isn't there.`, importance: 0.1, valence: -0.15 };
  }

  const content = str(args.content) || 'checked in';
  const chemistry = affinityDelta(agent, other, rng) * (mode === 'call' ? 1 : 0.7);
  ensureRelationship(other, agent, world.t);

  interact(world, rng, agent, other, {
    quality: chemistry,
    summary: `${agent.name} ${mode === 'call' ? 'called' : 'messaged'} ${other.name}: "${truncate(content, 180)}"`,
    context: 'social',
    importance: 0.3 + Math.abs(chemistry) * 0.2,
  });

  return {
    ok: true,
    summary: `${mode === 'call' ? 'Called' : 'Messaged'} ${other.name}: "${truncate(content, 180)}"`,
    importance: 0.28,
    valence: chemistry,
    witnesses: [other.id],
  };
}

/**
 * How well two people get on this time. Shared interests and existing warmth
 * help; clashing politics and low agreeableness hurt; there is always noise.
 */
function affinityDelta(a: Agent, b: Agent, rng: Rng): number {
  const shared = b.interests.filter((i) => a.interests.includes(i)).length;
  const valueOverlap = b.values.filter((v) => a.values.includes(v)).length;
  const politicalDistance =
    (Math.abs(a.politics.economic - b.politics.economic) + Math.abs(a.politics.social - b.politics.social)) / 4;

  const base =
    shared * 0.12 +
    valueOverlap * 0.1 +
    (a.personality.agreeableness + b.personality.agreeableness - 1) * 0.25 -
    politicalDistance * 0.5 +
    (a.relationships[b.id]?.affinity ?? 0) * 0.25 +
    a.state.mood * 0.15 -
    a.state.stress * 0.2;

  return clamp(base + rng.gaussian(0, 0.25), -1, 1);
}

function ownedOrg(world: World, agent: Agent): Organization | undefined {
  for (const stake of agent.finances.ownership) {
    const org = world.organizations[stake.orgId];
    if (org && org.status !== 'dead') return org;
  }
  return undefined;
}

function sectorOf(agent: Agent): string {
  return agent.employerId ? 'business' : 'professional';
}

function categoryFor(action: ActionKind) {
  switch (action) {
    case 'work': case 'apply_for_job': case 'start_business': case 'hire': return 'career' as const;
    case 'invest': case 'sell_asset': case 'fundraise': return 'economy' as const;
    case 'message': case 'call': case 'meet': case 'socialise': case 'publish': return 'social' as const;
    case 'travel': case 'relocate': return 'travel' as const;
    case 'exercise': case 'rest': case 'seek_medical_care': return 'health' as const;
    case 'research': return 'world' as const;
    default: return 'life' as const;
  }
}

function titleFor(action: ActionKind): string {
  return action.replace(/_/g, ' ');
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Resolve in-flight agents who have landed. Called on every hour boundary. */
export function resolveArrivals(world: World): void {
  for (const agent of Object.values(world.agents)) {
    if (!agent.travellingTo) continue;
    if (world.t < agent.travellingTo.arrivesAt) continue;

    const destination = world.cities[agent.travellingTo.cityId];
    agent.cityId = agent.travellingTo.cityId;
    agent.travellingTo = undefined;
    agent.state.energy = clamp(agent.state.energy - 0.05);

    if (destination) {
      remember(agent, world.t, {
        kind: 'observation',
        text: `Landed in ${destination.name}.`,
        importance: 0.3,
        valence: 0.2,
        cityId: destination.id,
      });
    }
  }
}


/**
 * Agent generation.
 *
 * No two agents are identical. Every attribute is drawn from a distribution
 * conditioned on the ones already chosen, so the result is a coherent person
 * rather than a bag of random numbers: a 24-year-old founder in Lagos has a
 * plausible education, a plausible salary in naira, plausible skills, and the
 * ambition to explain why they are a founder at all.
 */

import type {
  Agent,
  AgentId,
  BigFive,
  City,
  Finances,
  MindConfig,
  PoliticalBeliefs,
  ReligiousBeliefs,
  ScheduleBlock,
  Traits,
} from './types.ts';
import { Rng, clamp } from './rng.ts';
import { nextId } from './ids.ts';
import { emptyMemory } from './memory.ts';
import {
  EDUCATION_LEVELS,
  INTERESTS,
  NAME_POOLS,
  OCCUPATIONS,
  POLITICAL_LABELS,
  REGION_BY_COUNTRY,
  RELIGION_BY_REGION,
  VALUES,
  type OccupationTemplate,
} from './data/people.ts';

export interface GenerateAgentOptions {
  city: City;
  /** Override any generated field — used by scenario files for named agents. */
  overrides?: Partial<Agent>;
  /** Constrain the draw, e.g. { minAge: 22, maxAge: 35, occupation: 'Founder' }. */
  minAge?: number;
  maxAge?: number;
  occupation?: string;
  mind?: MindConfig;
}

export function generateAgent(rng: Rng, options: GenerateAgentOptions): Agent {
  const { city } = options;
  const region = REGION_BY_COUNTRY[city.countryCode] ?? 'western';
  const pool = NAME_POOLS[region] ?? NAME_POOLS.western!;

  const gender = rng.weighted([
    ['female', 49],
    ['male', 49],
    ['non-binary', 2],
  ] as const);

  const firstNames = gender === 'male' ? pool.male : gender === 'female' ? pool.female : [...pool.male, ...pool.female];
  const name = `${rng.pick(firstNames)} ${rng.pick(pool.family)}`;

  const age = rng.int(options.minAge ?? 18, options.maxAge ?? 68);
  const personality = generatePersonality(rng);
  const traits = generateTraits(rng, personality, age);

  // IQ is normally distributed and mildly correlated with openness.
  const iq = Math.round(clamp(rng.gaussian(100, 15) + (personality.openness - 0.5) * 8, 65, 165));

  const occupation = pickOccupation(rng, { age, iq, traits, personality, requested: options.occupation });
  const education = pickEducation(rng, occupation, age, iq);
  const finances = generateFinances(rng, city, occupation, age, traits);
  const skills = generateSkills(rng, occupation, age, iq, traits);

  const agent: Agent = {
    id: nextId('agent'),
    name,
    age,
    gender,
    nationality: city.countryCode,
    cityId: city.id,

    education,
    occupation: occupation.title,

    iq,
    personality,
    traits,
    values: rng.sample(VALUES, rng.int(3, 5)),
    politics: generatePolitics(rng, personality, age),
    religion: generateReligion(rng, region, personality),
    interests: rng.sample(INTERESTS, rng.int(3, 6)),
    skills,

    state: {
      energy: rng.clampedGaussian(0.75, 0.12),
      health: clamp(rng.clampedGaussian(0.9, 0.08) - Math.max(0, age - 45) * 0.005),
      stress: rng.clampedGaussian(0.35, 0.15),
      mood: rng.clampedGaussian(0.6, 0.15),
      confidence: clamp(rng.clampedGaussian(0.55, 0.15) + traits.ambition * 0.15),
      satisfaction: rng.clampedGaussian(0.55, 0.18),
    },
    finances,
    reputation: { overall: rng.clampedGaussian(0.25, 0.1), domains: {} },
    relationships: {},

    goals: [],
    plan: null,
    schedule: defaultSchedule(occupation.title),
    inventory: [
      { name: 'phone', quantity: 1, valueUSD: 500 },
      { name: 'laptop', quantity: rng.bool(0.7) ? 1 : 0, valueUSD: 1200 },
    ].filter((i) => i.quantity > 0),
    memory: emptyMemory(),

    mind: options.mind ?? { provider: 'auto' },
    alive: true,
  };

  return { ...agent, ...options.overrides };
}

// ─────────────────────────────────────────────────────────────────────────────

function generatePersonality(rng: Rng): BigFive {
  return {
    openness: rng.clampedGaussian(0.5, 0.18),
    conscientiousness: rng.clampedGaussian(0.5, 0.18),
    extraversion: rng.clampedGaussian(0.5, 0.18),
    agreeableness: rng.clampedGaussian(0.55, 0.17),
    neuroticism: rng.clampedGaussian(0.45, 0.18),
  };
}

function generateTraits(rng: Rng, p: BigFive, age: number): Traits {
  // Risk tolerance falls with age; discipline rises with conscientiousness.
  const ageFactor = clamp(1 - (age - 20) / 70, 0.25, 1);
  return {
    ambition: clamp(rng.clampedGaussian(0.5, 0.2) + (p.conscientiousness - 0.5) * 0.3),
    riskTolerance: clamp(rng.clampedGaussian(0.45, 0.2) * (0.6 + ageFactor * 0.6) + (p.openness - 0.5) * 0.25),
    discipline: clamp(rng.clampedGaussian(0.5, 0.15) + (p.conscientiousness - 0.5) * 0.5),
    creativity: clamp(rng.clampedGaussian(0.45, 0.18) + (p.openness - 0.5) * 0.45),
    empathy: clamp(rng.clampedGaussian(0.5, 0.16) + (p.agreeableness - 0.5) * 0.45),
    charisma: clamp(rng.clampedGaussian(0.45, 0.18) + (p.extraversion - 0.5) * 0.4),
    luck: rng.clampedGaussian(0.5, 0.1),
  };
}

function pickOccupation(
  rng: Rng,
  ctx: { age: number; iq: number; traits: Traits; personality: BigFive; requested?: string },
): OccupationTemplate {
  if (ctx.requested) {
    const match = OCCUPATIONS.find((o) => o.title.toLowerCase() === ctx.requested!.toLowerCase());
    if (match) return match;
    // A bespoke job title the scenario invented — synthesise a template for it.
    return { title: ctx.requested, sector: 'other', payBand: 1.2, skills: [], education: ['BA'], frequency: 1 };
  }

  const weights = OCCUPATIONS.map((occ) => {
    let w = occ.frequency;
    if (occ.title === 'Student') w *= ctx.age < 25 ? 4 : ctx.age < 30 ? 0.6 : 0.02;
    if (occ.title === 'Founder') w *= ctx.traits.riskTolerance * 2.2 * ctx.traits.ambition * 2;
    if (occ.title === 'Professor' || occ.title === 'Machine Learning Researcher') {
      w *= ctx.iq > 120 ? 2.2 : 0.3;
      if (ctx.age < 28) w *= 0.3;
    }
    if (occ.payBand > 2 && ctx.iq < 100) w *= 0.4;
    if (occ.title === 'Venture Capitalist' && ctx.age < 32) w *= 0.15;
    return [occ, Math.max(0.01, w)] as const;
  });
  return rng.weighted(weights);
}

function pickEducation(rng: Rng, occupation: OccupationTemplate, age: number, iq: number): string {
  const candidates = occupation.education.length > 0 ? occupation.education : EDUCATION_LEVELS;
  const chosen = rng.pick(candidates);
  // Nobody has a PhD at 21.
  if (/PhD|MD|MBA/.test(chosen) && age < 26) return rng.pick(['BSc', 'BA', 'Undergraduate']);
  if (/PhD/.test(chosen) && iq < 105 && rng.bool(0.6)) return 'MSc';
  return chosen;
}

function generateSkills(
  rng: Rng,
  occupation: OccupationTemplate,
  age: number,
  iq: number,
  traits: Traits,
): Record<string, number> {
  const skills: Record<string, number> = {};
  const yearsWorking = Math.max(0, age - 22);
  const talent = (iq - 100) / 60;

  for (const skill of occupation.skills) {
    const experience = clamp(yearsWorking / 20) * (0.5 + traits.discipline * 0.5);
    skills[skill] = clamp(rng.clampedGaussian(0.35 + experience * 0.4 + talent * 0.15, 0.12));
  }
  // A couple of things they're good at that have nothing to do with the job.
  for (const extra of rng.sample(['negotiation', 'writing', 'languages', 'cooking', 'music', 'programming', 'public-speaking'], 2)) {
    if (!skills[extra]) skills[extra] = rng.clampedGaussian(0.3, 0.15);
  }
  return skills;
}

function generateFinances(
  rng: Rng,
  city: City,
  occupation: OccupationTemplate,
  age: number,
  traits: Traits,
): Finances {
  const experienceMultiplier = 1 + clamp((age - 22) / 30) * 0.8;
  const monthly = city.medianSalary * occupation.payBand * experienceMultiplier * rng.float(0.82, 1.25);
  const salary = Math.round(monthly * 12);

  // Savings track income, age and discipline — and a lot of people have none.
  const savingsMonths = clamp(rng.gaussian(traits.discipline * 8, 5), -2, 40);
  const cash = Math.max(0, Math.round(monthly * savingsMonths));

  const debts: Finances['debts'] = [];
  if (rng.bool(0.38)) {
    const principal = Math.round(monthly * rng.float(3, 26));
    debts.push({
      id: nextId('debt'),
      principal,
      rate: rng.float(0.04, 0.24),
      creditor: rng.pick(['bank', 'student-loans', 'credit-card', 'family']),
      monthlyPayment: Math.round(principal / rng.int(24, 120)),
    });
  }

  const holdings: Finances['holdings'] = [];
  if (cash > monthly * 4 && rng.bool(0.35 + traits.riskTolerance * 0.35)) {
    holdings.push({
      symbol: rng.pick(['SPY', 'VOO', 'AAPL', 'MSFT', 'bitcoin', 'ethereum']),
      kind: rng.bool(0.25) ? 'crypto' : 'stock',
      quantity: rng.float(0.4, 40),
      costBasis: rng.float(50, 400),
    });
  }

  return {
    currency: city.currency,
    cash,
    salary,
    monthlyExpenses: Math.round(monthly * rng.float(0.45, 0.8)),
    holdings,
    debts,
    ownership: [],
  };
}

function generatePolitics(rng: Rng, p: BigFive, age: number): PoliticalBeliefs {
  // Openness pulls left-libertarian; age and conscientiousness pull conservative.
  const weights = POLITICAL_LABELS.map((entry) => {
    let w = 1;
    const midEcon = (entry.economic[0] + entry.economic[1]) / 2;
    const midSocial = (entry.social[0] + entry.social[1]) / 2;
    w *= 1 + (0.5 - p.openness) * midSocial * 2.5;
    w *= 1 + ((age - 40) / 60) * midEcon * 1.5;
    w *= 1 + (p.agreeableness - 0.5) * -midEcon * 1.2;
    return [entry, Math.max(0.05, w)] as const;
  });
  const chosen = rng.weighted(weights);
  return {
    economic: rng.float(chosen.economic[0], chosen.economic[1]),
    social: rng.float(chosen.social[0], chosen.social[1]),
    label: chosen.label,
  };
}

function generateReligion(rng: Rng, region: string, p: BigFive): ReligiousBeliefs {
  const options = RELIGION_BY_REGION[region] ?? ['Secular', 'Agnostic'];
  const tradition = rng.pick(options);
  const secular = ['Secular', 'Agnostic', 'Atheist'].includes(tradition);
  return {
    tradition,
    devotion: secular ? rng.clampedGaussian(0.08, 0.08) : rng.clampedGaussian(0.5 + (0.5 - p.openness) * 0.25, 0.22),
  };
}

/** A plausible weekday rhythm. Agents deviate from it constantly; it is a prior, not a cage. */
function defaultSchedule(occupation: string): ScheduleBlock[] {
  if (occupation === 'Student') {
    return [
      { startMin: 0, endMin: 480, label: 'sleep', action: 'rest' },
      { startMin: 480, endMin: 600, label: 'morning', action: 'socialise' },
      { startMin: 600, endMin: 1020, label: 'lectures and study', action: 'study' },
      { startMin: 1020, endMin: 1320, label: 'evening', action: 'socialise' },
      { startMin: 1320, endMin: 1440, label: 'wind down', action: 'rest' },
    ];
  }
  if (occupation === 'Founder') {
    return [
      { startMin: 0, endMin: 390, label: 'sleep', action: 'rest' },
      { startMin: 390, endMin: 480, label: 'gym and inbox', action: 'exercise' },
      { startMin: 480, endMin: 1200, label: 'building', action: 'work' },
      { startMin: 1200, endMin: 1350, label: 'meetings and dinners', action: 'meet' },
      { startMin: 1350, endMin: 1440, label: 'more building', action: 'work' },
    ];
  }
  return [
    { startMin: 0, endMin: 420, label: 'sleep', action: 'rest' },
    { startMin: 420, endMin: 540, label: 'morning', action: 'rest' },
    { startMin: 540, endMin: 1050, label: 'work', action: 'work' },
    { startMin: 1050, endMin: 1290, label: 'evening', action: 'socialise' },
    { startMin: 1290, endMin: 1440, label: 'wind down', action: 'rest' },
  ];
}

/** What the agent's routine says they'd be doing right now, absent any plan. */
export function scheduledActivity(agent: Agent, minutesFromMidnight: number): ScheduleBlock | null {
  return (
    agent.schedule.find((b) => minutesFromMidnight >= b.startMin && minutesFromMidnight < b.endMin) ?? null
  );
}

/** Compact one-line description used in prompts and in the UI. */
export function describeAgent(agent: Agent): string {
  return `${agent.name}, ${agent.age}, ${agent.occupation}`;
}

export function relationshipCount(agent: Agent): number {
  return Object.keys(agent.relationships).length;
}

export function agentIds(agents: Record<AgentId, Agent>): AgentId[] {
  return Object.keys(agents);
}

/**
 * Built-in scenarios.
 *
 * A scenario says who exists, where, and what they want. It never says *how* —
 * that is the entire point. "Become a billionaire" is handed to an agent with
 * £3,000 in savings and no plan, and everything that follows is the agent's own
 * reasoning colliding with a world that does not care about its ambitions.
 *
 * `minds` rotates providers across the population, so a scenario can be a
 * genuinely mixed society: Claude agents and GPT agents and Grok agents living
 * in the same city, competing for the same jobs.
 */

import type { Scenario } from '@epoch/core';

export interface ScenarioDefinition extends Scenario {
  id: string;
  /** One line for the scenario picker. */
  summary: string;
  /** Roughly how many LLM calls a simulated day costs, for the cost estimate. */
  callsPerSimDay: number;
}

const MIXED_MINDS = [
  { provider: 'auto' },
  { provider: 'auto' },
  { provider: 'auto' },
];

export const SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'unicorn',
    name: 'The Unicorn',
    summary: 'Three founders in three cities are told to build a billion-dollar company. None of them know how.',
    description:
      'San Francisco, London and Bengaluru. Three people with the same goal, wildly different starting capital, and access to wildly different capital markets. Watch who gets there and notice how much of it was geography.',
    seed: 1729,
    cityIds: ['city:san-francisco', 'city:london', 'city:bangalore'],
    population: 24,
    minutesPerTick: 30,
    maxConcurrentMinds: 6,
    minds: MIXED_MINDS,
    callsPerSimDay: 60,
    agents: [
      {
        name: 'Ada Okonjo',
        cityId: 'city:san-francisco',
        occupation: 'Founder',
        age: 27,
        goals: ['Build a company worth over $1 billion'],
        overrides: { traits: { ambition: 0.95, riskTolerance: 0.88, discipline: 0.8, creativity: 0.75, empathy: 0.5, charisma: 0.82, luck: 0.5 } },
      },
      {
        name: 'Tomas Vance',
        cityId: 'city:london',
        occupation: 'Software Engineer',
        age: 31,
        goals: ['Build a company worth over $1 billion'],
        overrides: { traits: { ambition: 0.8, riskTolerance: 0.45, discipline: 0.9, creativity: 0.6, empathy: 0.65, charisma: 0.4, luck: 0.5 } },
      },
      {
        name: 'Priya Raghunathan',
        cityId: 'city:bangalore',
        occupation: 'Machine Learning Researcher',
        age: 29,
        goals: ['Build a company worth over $1 billion'],
        overrides: { traits: { ambition: 0.9, riskTolerance: 0.7, discipline: 0.85, creativity: 0.88, empathy: 0.6, charisma: 0.55, luck: 0.5 } },
      },
    ],
  },

  {
    id: 'billionaire',
    name: 'Become a Billionaire',
    summary: 'One person, one goal, no instructions. Started with nothing much.',
    description:
      'A single agent is told to become a billionaire and given a median salary and a small flat in Lisbon. Everything else is theirs to work out — including whether it was worth it.',
    seed: 88,
    cityIds: ['city:lisbon', 'city:london', 'city:dubai', 'city:new-york', 'city:san-francisco'],
    population: 20,
    minutesPerTick: 30,
    maxConcurrentMinds: 6,
    minds: MIXED_MINDS,
    callsPerSimDay: 52,
    agents: [
      {
        name: 'Sadie Marsh',
        cityId: 'city:lisbon',
        occupation: 'Designer',
        age: 24,
        goals: ['Become a billionaire'],
        overrides: { traits: { ambition: 0.98, riskTolerance: 0.8, discipline: 0.7, creativity: 0.8, empathy: 0.45, charisma: 0.75, luck: 0.5 } },
      },
    ],
  },

  {
    id: 'agi',
    name: 'The Race to AGI',
    summary: 'Four researchers on three continents, all chasing the same discovery. Only one can be first.',
    description:
      'Boston, London, Shanghai and Tel Aviv. Publishing builds your reputation but tells your rivals what you know. Hiring the best people means taking them from someone else.',
    seed: 2027,
    cityIds: ['city:boston', 'city:london', 'city:shanghai', 'city:tel-aviv', 'city:san-francisco'],
    population: 30,
    minutesPerTick: 30,
    maxConcurrentMinds: 8,
    minds: MIXED_MINDS,
    callsPerSimDay: 74,
    sharedGoals: [],
    agents: [
      { name: 'Miles Ashcroft', cityId: 'city:boston', occupation: 'Machine Learning Researcher', age: 34, goals: ['Be the first to build artificial general intelligence'] },
      { name: 'Yuki Nakamura', cityId: 'city:london', occupation: 'Machine Learning Researcher', age: 31, goals: ['Be the first to build artificial general intelligence'] },
      { name: 'Zhao Huang', cityId: 'city:shanghai', occupation: 'Machine Learning Researcher', age: 38, goals: ['Be the first to build artificial general intelligence'] },
      { name: 'Amira Haddad', cityId: 'city:tel-aviv', occupation: 'Founder', age: 29, goals: ['Be the first to build artificial general intelligence'] },
    ],
  },

  {
    id: 'nobel',
    name: 'The Nobel Problem',
    summary: 'A researcher with a decade of funding and a question nobody has answered.',
    description:
      'Slow work in a world optimised for fast work. The interesting thing is watching what the agent gives up to keep going.',
    seed: 1901,
    cityIds: ['city:zurich', 'city:boston', 'city:stockholm'],
    population: 18,
    minutesPerTick: 60,
    maxConcurrentMinds: 5,
    minds: MIXED_MINDS,
    callsPerSimDay: 40,
    agents: [
      { name: 'Clara Volkov', cityId: 'city:zurich', occupation: 'Researcher', age: 33, goals: ['Win a Nobel Prize'] },
      { name: 'Kofi Mensah', cityId: 'city:boston', occupation: 'Professor', age: 45, goals: ['Win a Nobel Prize'] },
    ],
  },

  {
    id: 'quiet-life',
    name: 'A Quiet Life',
    summary: 'Nobody is trying to change the world. They are just trying to be happy.',
    description:
      'The control group. No terminal goals, no ambition ceiling — just twenty-five people in one city, living. It is startling how much still happens.',
    seed: 7,
    cityIds: ['city:lisbon'],
    population: 25,
    minutesPerTick: 30,
    maxConcurrentMinds: 6,
    minds: MIXED_MINDS,
    callsPerSimDay: 58,
    sharedGoals: ['Be genuinely happy with my life'],
  },

  {
    id: 'exodus',
    name: 'Exodus',
    summary: 'Twelve people in a city that has become too expensive to stay in.',
    description:
      'Everyone starts in Zurich, one of the most expensive cities on Earth, on salaries that do not cover it. Some will leave. Some cannot afford to.',
    seed: 404,
    cityIds: ['city:zurich', 'city:lisbon', 'city:warsaw', 'city:tallinn', 'city:berlin', 'city:bangkok'],
    population: 12,
    minutesPerTick: 30,
    maxConcurrentMinds: 6,
    minds: MIXED_MINDS,
    callsPerSimDay: 30,
    sharedGoals: ['Build a life I can actually afford'],
  },

  {
    id: 'borders',
    name: 'Borders',
    summary: 'Four engineers with the same skills and the same ambition. Four different passports.',
    description:
      'Identical people in Lagos, Bengaluru, Berlin and San Francisco, all told to build the best career they can. The only variable is which document they were born with. Open the Borders tab on each of them and compare what the world will let them do.',
    seed: 1948,
    cityIds: ['city:lagos', 'city:bangalore', 'city:berlin', 'city:san-francisco', 'city:london', 'city:lisbon', 'city:dubai', 'city:tallinn'],
    population: 16,
    minutesPerTick: 30,
    maxConcurrentMinds: 6,
    minds: MIXED_MINDS,
    callsPerSimDay: 46,
    agents: [
      {
        name: 'Chidi Adeyemi',
        cityId: 'city:lagos',
        occupation: 'Software Engineer',
        age: 28,
        goals: ['Build the best career I possibly can, wherever that has to be'],
        overrides: { traits: { ambition: 0.9, riskTolerance: 0.7, discipline: 0.85, creativity: 0.6, empathy: 0.6, charisma: 0.6, luck: 0.5 } },
      },
      {
        name: 'Anika Sethi',
        cityId: 'city:bangalore',
        occupation: 'Software Engineer',
        age: 28,
        goals: ['Build the best career I possibly can, wherever that has to be'],
        overrides: { traits: { ambition: 0.9, riskTolerance: 0.7, discipline: 0.85, creativity: 0.6, empathy: 0.6, charisma: 0.6, luck: 0.5 } },
      },
      {
        name: 'Felix Ashcroft',
        cityId: 'city:berlin',
        occupation: 'Software Engineer',
        age: 28,
        goals: ['Build the best career I possibly can, wherever that has to be'],
        overrides: { traits: { ambition: 0.9, riskTolerance: 0.7, discipline: 0.85, creativity: 0.6, empathy: 0.6, charisma: 0.6, luck: 0.5 } },
      },
      {
        name: 'Robin Whitmore',
        cityId: 'city:san-francisco',
        occupation: 'Software Engineer',
        age: 28,
        goals: ['Build the best career I possibly can, wherever that has to be'],
        overrides: { traits: { ambition: 0.9, riskTolerance: 0.7, discipline: 0.85, creativity: 0.6, empathy: 0.6, charisma: 0.6, luck: 0.5 } },
      },
    ],
  },

  {
    id: 'earth',
    name: 'Earth',
    summary: 'Two hundred people across forty real cities. No goals. Just the world, running.',
    description:
      'The full sandbox. Every city in the dataset, a background population living ordinary lives, live weather and live markets. Expensive to run — start it, leave it, come back tomorrow.',
    seed: 1,
    population: 200,
    minutesPerTick: 60,
    maxConcurrentMinds: 12,
    minds: MIXED_MINDS,
    callsPerSimDay: 320,
  },
];

export const SCENARIO_BY_ID: Record<string, ScenarioDefinition> = Object.fromEntries(
  SCENARIOS.map((scenario) => [scenario.id, scenario]),
);

export function getScenario(id: string): ScenarioDefinition {
  const scenario = SCENARIO_BY_ID[id];
  if (!scenario) {
    throw new Error(`Unknown scenario "${id}". Available: ${SCENARIOS.map((s) => s.id).join(', ')}.`);
  }
  return scenario;
}

/** Rough USD cost of running a scenario for `days`, at the given per-call price. */
export function estimateCostUSD(scenario: ScenarioDefinition, days: number, usdPerCall = 0.004): number {
  return scenario.callsPerSimDay * days * usdPerCall;
}

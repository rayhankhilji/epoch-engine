/**
 * @epoch/core — the simulation engine.
 *
 * This package has no dependencies and never talks to the network. It knows how
 * a society works; `@epoch/llm` supplies the thinking and `@epoch/world` supplies
 * live reality.
 */

export * from './types.ts';
export * from './rng.ts';
export * from './ids.ts';
export * from './time.ts';
export * from './events.ts';
export * from './memory.ts';
export * from './agents.ts';
export * from './social.ts';
export * from './economy.ts';
export * from './actions.ts';
export * from './cognition.ts';
export * from './world.ts';
export * from './simulation.ts';

export { CITIES, CITY_BY_ID, haversineKm, flightHours, flightCostUSD } from './data/cities.ts';
export {
  OCCUPATIONS,
  VALUES,
  INTERESTS,
  NAME_POOLS,
  REGION_BY_COUNTRY,
  POLITICAL_LABELS,
  RELIGIONS,
} from './data/people.ts';

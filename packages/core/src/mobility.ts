/**
 * Whether an agent is allowed to go somewhere.
 *
 * Bridges the visa dataset to a live agent: works out what they could offer a
 * destination — a sponsor, savings, a reputation — and asks what that buys.
 */

import type { Agent, City, World } from './types.ts';
import { assessMobility, describeMobility, passportStrength, type Mobility } from './data/visas.ts';
import { averageSkill, toUSD } from './economy.ts';

export { describeMobility, passportStrength };
export type { Mobility };

/**
 * Can this agent move to this city, and on what terms?
 *
 * A sponsor counts when the agent already works for a company based there —
 * which is why `apply_for_job` at a foreign company is so often the move that
 * unlocks a relocation an agent could not otherwise make.
 */
export function mobilityFor(world: World, agent: Agent, city: City): Mobility {
  const employer = agent.employerId ? world.organizations[agent.employerId] : undefined;
  const employerCity = employer ? world.cities[employer.cityId] : undefined;

  // Their own company counts too: a founder can sponsor themselves once the
  // company is real enough to be worth something.
  const ownsSomethingThere = agent.finances.ownership.some((stake) => {
    const org = world.organizations[stake.orgId];
    return org != null && org.status !== 'dead' && world.cities[org.cityId]?.countryCode === city.countryCode;
  });

  const hasSponsor =
    ownsSomethingThere || (employerCity != null && employerCity.countryCode === city.countryCode);

  // Best single skill, not the average: a sponsor buys the one thing you are
  // genuinely good at.
  const best = Math.max(averageSkill(agent), ...Object.values(agent.skills), 0);

  return assessMobility({
    nationality: agent.nationality,
    destination: city.countryCode,
    skill: best,
    reputation: agent.reputation.overall,
    savingsUSD: toUSD(world.market, agent.finances.cash, agent.finances.currency),
    hasSponsor,
  });
}

/**
 * A short note on how easily this person moves around the world at all.
 * Shown in the agent inspector, because it explains a great deal about the
 * shape of their options.
 */
export function describePassport(agent: Agent): string {
  const strength = passportStrength(agent.nationality);
  if (strength >= 0.9) return 'very strong — most of the world is open to you on arrival';
  if (strength >= 0.7) return 'strong — much of the world is straightforward';
  if (strength >= 0.5) return 'moderate — a lot of places need arranging in advance';
  if (strength >= 0.3) return 'limited — most travel needs a visa applied for in advance';
  return 'weak — almost everywhere requires a visa, and many are refused';
}

/**
 * The economy.
 *
 * Agents hold real currencies, earn real-ish salaries for their city, pay rent
 * indexed to local cost of living, service debt, and hold positions in
 * instruments whose prices come from live market data. Every sim-month the
 * ledger settles; agents who spend more than they earn genuinely run out of
 * money, and that constraint is what makes their ambitions cost something.
 */

import type {
  Agent,
  City,
  MarketState,
  Organization,
  World,
  Holding,
  OrgId,
  AgentId,
  SimTime,
} from './types.ts';
import { Rng, clamp } from './rng.ts';
import { nextId } from './ids.ts';
import { emit } from './events.ts';
import { remember } from './memory.ts';

/**
 * USD per one unit of currency. Used until `@epoch/world` fetches live rates
 * from Frankfurter, and as the fallback whenever the network is unavailable.
 */
export const FALLBACK_FX: Record<string, number> = {
  USD: 1, EUR: 1.09, GBP: 1.27, CHF: 1.12, CAD: 0.73, AUD: 0.66, SGD: 0.74,
  JPY: 0.0064, CNY: 0.138, INR: 0.012, KRW: 0.00073, HKD: 0.128, TWD: 0.031,
  BRL: 0.185, MXN: 0.052, ARS: 0.00098, NGN: 0.00065, KES: 0.0077, ZAR: 0.055,
  EGP: 0.021, AED: 0.272, ILS: 0.27, SEK: 0.095, NOK: 0.093, DKK: 0.146,
  PLN: 0.25, TRY: 0.029, THB: 0.028, IDR: 0.000062, GHS: 0.066, PHP: 0.017,
  VND: 0.00004, RUB: 0.011, CZK: 0.043, HUF: 0.0027, NZD: 0.60, SAR: 0.267,
};

export function usdRate(market: MarketState, currency: string): number {
  return market.fx[currency] ?? FALLBACK_FX[currency] ?? 1;
}

export function toUSD(market: MarketState, amount: number, currency: string): number {
  return amount * usdRate(market, currency);
}

export function fromUSD(market: MarketState, amountUSD: number, currency: string): number {
  const rate = usdRate(market, currency);
  return rate === 0 ? 0 : amountUSD / rate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Valuation
// ─────────────────────────────────────────────────────────────────────────────

export function holdingValueUSD(market: MarketState, holding: Holding): number {
  const quote = market.quotes[holding.symbol];
  const price = quote?.price ?? holding.costBasis;
  const priceUSD = quote ? toUSD(market, price, quote.currency) : holding.costBasis;
  return holding.quantity * priceUSD;
}

export function portfolioValueUSD(market: MarketState, agent: Agent): number {
  return agent.finances.holdings.reduce((sum, h) => sum + holdingValueUSD(market, h), 0);
}

export function netWorthUSD(world: World, agent: Agent): number {
  const { market } = world;
  const cash = toUSD(market, agent.finances.cash, agent.finances.currency);
  const portfolio = portfolioValueUSD(market, agent);
  const debt = agent.finances.debts.reduce(
    (sum, d) => sum + toUSD(market, d.principal, agent.finances.currency),
    0,
  );
  const equity = agent.finances.ownership.reduce((sum, o) => {
    const org = world.organizations[o.orgId];
    return sum + (org && org.status !== 'dead' ? org.valuation * o.fraction : 0);
  }, 0);
  const stuff = agent.inventory.reduce((sum, i) => sum + i.valueUSD * i.quantity, 0);
  return cash + portfolio + equity + stuff - debt;
}

/** Months of runway at the agent's current burn. `Infinity` when income covers it. */
export function personalRunwayMonths(world: World, agent: Agent): number {
  const city = world.cities[agent.cityId];
  const burn = monthlyBurn(agent, city);
  const income = agent.finances.salary / 12;
  if (income >= burn) return Infinity;
  const deficit = burn - income;
  return deficit <= 0 ? Infinity : agent.finances.cash / deficit;
}

/** Total monthly outgoings: living costs, rent-equivalent and debt service. */
export function monthlyBurn(agent: Agent, city?: City): number {
  const colMultiplier = city ? city.costOfLivingIndex / 100 : 1;
  const rent = city ? city.medianSalary * 0.32 * colMultiplier : 0;
  const debtService = agent.finances.debts.reduce((sum, d) => sum + d.monthlyPayment, 0);
  return agent.finances.monthlyExpenses + rent + debtService;
}

// ─────────────────────────────────────────────────────────────────────────────
// Monthly settlement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run payroll, rent, expenses and debt for every agent. Called once per
 * simulated month. Agents who go negative accrue emergency credit at a punitive
 * rate — and remember it, which is how "I hate debt" becomes a real belief.
 */
export function settleMonth(world: World, rng: Rng): void {
  for (const agent of Object.values(world.agents)) {
    if (!agent.alive) continue;
    const city = world.cities[agent.cityId];
    const income = agent.finances.salary / 12;
    const burn = monthlyBurn(agent, city);

    agent.finances.cash += income - burn;

    // Amortise debt.
    for (const debt of agent.finances.debts) {
      debt.principal = Math.max(0, debt.principal * (1 + debt.rate / 12) - debt.monthlyPayment);
    }
    agent.finances.debts = agent.finances.debts.filter((d) => d.principal > 1);

    if (agent.finances.cash < 0) {
      const shortfall = -agent.finances.cash;
      agent.finances.cash = 0;
      agent.finances.debts.push({
        id: nextId('debt'),
        principal: shortfall,
        rate: 0.29,
        creditor: 'emergency-credit',
        monthlyPayment: Math.max(25, shortfall / 24),
      });
      agent.state.stress = clamp(agent.state.stress + 0.18);
      agent.state.mood = clamp(agent.state.mood - 0.1);
      remember(agent, world.t, {
        kind: 'event',
        text: `I ran out of money this month and had to borrow ${Math.round(shortfall)} ${agent.finances.currency} at 29% just to cover the basics.`,
        importance: 0.75,
        valence: -0.7,
      });
      emit(world, {
        category: 'economy',
        title: `${agent.name} went into emergency debt`,
        detail: `Short by ${Math.round(shortfall)} ${agent.finances.currency} after monthly outgoings.`,
        agentIds: [agent.id],
        cityId: agent.cityId,
        importance: 0.45,
      });
    } else if (agent.finances.cash > income * 6 && rng.bool(0.15)) {
      agent.state.satisfaction = clamp(agent.state.satisfaction + 0.04);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Investing
// ─────────────────────────────────────────────────────────────────────────────

export interface TradeResult {
  ok: boolean;
  message: string;
  filledUSD: number;
}

export function buyAsset(
  world: World,
  agent: Agent,
  symbol: string,
  amountUSD: number,
): TradeResult {
  const quote = world.market.quotes[symbol];
  if (!quote) return { ok: false, message: `No market data for ${symbol}.`, filledUSD: 0 };

  const cashUSD = toUSD(world.market, agent.finances.cash, agent.finances.currency);
  const spendUSD = Math.min(amountUSD, cashUSD);
  if (spendUSD < 1) return { ok: false, message: 'Not enough cash to invest.', filledUSD: 0 };

  const priceUSD = toUSD(world.market, quote.price, quote.currency);
  if (priceUSD <= 0) return { ok: false, message: `Bad price for ${symbol}.`, filledUSD: 0 };

  const quantity = spendUSD / priceUSD;
  agent.finances.cash -= fromUSD(world.market, spendUSD, agent.finances.currency);

  const existing = agent.finances.holdings.find((h) => h.symbol === symbol);
  if (existing) {
    const totalCost = existing.costBasis * existing.quantity + priceUSD * quantity;
    existing.quantity += quantity;
    existing.costBasis = totalCost / existing.quantity;
  } else {
    agent.finances.holdings.push({
      symbol,
      kind: quote.kind === 'crypto' ? 'crypto' : 'stock',
      quantity,
      costBasis: priceUSD,
    });
  }

  return {
    ok: true,
    message: `Bought ${quantity.toFixed(4)} ${symbol} at $${priceUSD.toFixed(2)} (${spendUSD.toFixed(0)} USD).`,
    filledUSD: spendUSD,
  };
}

export function sellAsset(world: World, agent: Agent, symbol: string, fraction = 1): TradeResult {
  const holding = agent.finances.holdings.find((h) => h.symbol === symbol);
  if (!holding) return { ok: false, message: `No position in ${symbol}.`, filledUSD: 0 };

  const sellQty = holding.quantity * clamp(fraction, 0, 1);
  const quote = world.market.quotes[symbol];
  const priceUSD = quote ? toUSD(world.market, quote.price, quote.currency) : holding.costBasis;
  const proceedsUSD = sellQty * priceUSD;
  const pnlUSD = (priceUSD - holding.costBasis) * sellQty;

  holding.quantity -= sellQty;
  if (holding.quantity < 1e-9) {
    agent.finances.holdings = agent.finances.holdings.filter((h) => h !== holding);
  }
  agent.finances.cash += fromUSD(world.market, proceedsUSD, agent.finances.currency);

  return {
    ok: true,
    message: `Sold ${sellQty.toFixed(4)} ${symbol} for $${proceedsUSD.toFixed(0)} (${pnlUSD >= 0 ? '+' : ''}$${pnlUSD.toFixed(0)} P&L).`,
    filledUSD: proceedsUSD,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Organisations
// ─────────────────────────────────────────────────────────────────────────────

export function foundOrganization(
  world: World,
  founder: Agent,
  input: { name: string; sector: string; description: string; kind?: Organization['kind'] },
): Organization {
  const org: Organization = {
    id: nextId('org'),
    name: input.name,
    kind: input.kind ?? 'startup',
    cityId: founder.cityId,
    founderIds: [founder.id],
    employeeIds: [founder.id],
    foundedAt: world.t,
    valuation: 0,
    cashUSD: Math.max(0, toUSD(world.market, founder.finances.cash, founder.finances.currency) * 0.3),
    monthlyBurnUSD: 0,
    monthlyRevenueUSD: 0,
    sector: input.sector,
    description: input.description,
    status: 'active',
  };

  // The founder capitalises the company out of personal savings.
  founder.finances.cash *= 0.7;
  founder.finances.ownership.push({ orgId: org.id, fraction: 1 });
  founder.employerId = org.id;
  founder.occupation = 'Founder';

  world.organizations[org.id] = org;
  world.stats.orgsFounded++;

  emit(world, {
    category: 'career',
    title: `${founder.name} founded ${org.name}`,
    detail: `${input.description} — a ${org.kind} in ${input.sector}, based in ${world.cities[founder.cityId]?.name ?? 'unknown'}.`,
    agentIds: [founder.id],
    orgIds: [org.id],
    cityId: founder.cityId,
    importance: 0.85,
  });

  return org;
}

export interface RaiseResult {
  ok: boolean;
  message: string;
  raisedUSD: number;
  valuation: number;
}

/**
 * Attempt to raise capital. Success depends on the founder's track record,
 * charisma and reputation, the company's revenue, and the city's access to
 * capital — raising in San Francisco is materially easier than in Accra, which
 * is exactly the kind of unfairness the simulation should model honestly.
 */
export function attemptRaise(
  world: World,
  rng: Rng,
  founder: Agent,
  org: Organization,
  askUSD: number,
): RaiseResult {
  const city = world.cities[org.cityId];
  const capitalAccess = city?.tags.includes('venture-capital') ? 1.35 : city?.tags.includes('tech-hub') ? 1.1 : 0.7;
  const traction = clamp(Math.log10(1 + org.monthlyRevenueUSD) / 5);
  const credibility =
    founder.reputation.overall * 0.35 +
    founder.traits.charisma * 0.25 +
    (founder.skills['fundraising'] ?? 0) * 0.2 +
    traction * 0.2;

  const probability = clamp(credibility * capitalAccess * 0.9, 0.02, 0.92);
  if (!rng.bool(probability)) {
    founder.state.confidence = clamp(founder.state.confidence - 0.06);
    founder.state.stress = clamp(founder.state.stress + 0.08);
    return { ok: false, message: 'The round did not come together. Investors passed.', raisedUSD: 0, valuation: org.valuation };
  }

  const raised = askUSD * rng.float(0.45, 1.15);
  const dilution = clamp(rng.float(0.1, 0.25) * (1 - traction * 0.4), 0.05, 0.35);
  const postMoney = raised / dilution;

  org.cashUSD += raised;
  org.valuation = Math.max(org.valuation, postMoney);

  // Dilute every existing shareholder proportionally.
  for (const agent of Object.values(world.agents)) {
    for (const stake of agent.finances.ownership) {
      if (stake.orgId === org.id) stake.fraction *= 1 - dilution;
    }
  }

  founder.state.confidence = clamp(founder.state.confidence + 0.12);
  founder.reputation.overall = clamp(founder.reputation.overall + 0.08);
  founder.reputation.domains['business'] = clamp((founder.reputation.domains['business'] ?? 0.2) + 0.12);

  emit(world, {
    category: 'economy',
    title: `${org.name} raised $${formatCompact(raised)}`,
    detail: `${founder.name} closed a round at a $${formatCompact(postMoney)} post-money valuation, giving up ${(dilution * 100).toFixed(1)}%.`,
    agentIds: [founder.id],
    orgIds: [org.id],
    cityId: org.cityId,
    importance: 0.9,
  });

  return {
    ok: true,
    message: `Raised $${formatCompact(raised)} at a $${formatCompact(postMoney)} post-money valuation.`,
    raisedUSD: raised,
    valuation: postMoney,
  };
}

export function hireInto(world: World, org: Organization, hire: Agent, salaryUSD: number): boolean {
  if (org.cashUSD < salaryUSD / 6) return false;

  if (hire.employerId) {
    const old = world.organizations[hire.employerId];
    if (old) old.employeeIds = old.employeeIds.filter((id) => id !== hire.id);
  }

  org.employeeIds.push(hire.id);
  org.monthlyBurnUSD += salaryUSD / 12;
  hire.employerId = org.id;
  hire.cityId = org.cityId;
  hire.finances.salary = fromUSD(world.market, salaryUSD, hire.finances.currency);

  emit(world, {
    category: 'career',
    title: `${hire.name} joined ${org.name}`,
    detail: `Hired as ${hire.occupation} at $${formatCompact(salaryUSD)}/yr.`,
    agentIds: [hire.id, ...org.founderIds],
    orgIds: [org.id],
    cityId: org.cityId,
    importance: 0.6,
  });
  return true;
}

/**
 * Advance every company by a month: revenue grows with headcount quality,
 * burn eats cash, and companies that hit zero die and take their equity with
 * them.
 */
export function operateOrganizations(world: World, rng: Rng): void {
  for (const org of Object.values(world.organizations)) {
    if (org.status === 'dead') continue;

    const team = org.employeeIds.map((id) => world.agents[id]).filter((a): a is Agent => a != null);
    const teamQuality =
      team.length === 0
        ? 0
        : team.reduce((sum, a) => sum + averageSkill(a) * 0.6 + a.state.energy * 0.4, 0) / team.length;

    const growth = 1 + (teamQuality - 0.35) * 0.22 + rng.gaussian(0, 0.09);
    org.monthlyRevenueUSD = Math.max(0, org.monthlyRevenueUSD * clamp(growth, 0.6, 1.9));

    // A company with paying customers and a decent team starts making money.
    if (org.monthlyRevenueUSD === 0 && team.length > 0 && rng.bool(teamQuality * 0.28)) {
      org.monthlyRevenueUSD = rng.float(500, 9000) * team.length;
      emit(world, {
        category: 'economy',
        title: `${org.name} landed its first revenue`,
        detail: `$${formatCompact(org.monthlyRevenueUSD)} MRR.`,
        agentIds: org.founderIds,
        orgIds: [org.id],
        cityId: org.cityId,
        importance: 0.7,
      });
    }

    org.cashUSD += org.monthlyRevenueUSD - org.monthlyBurnUSD;

    // Valuation follows revenue with a sector multiple, ratcheting on the high-water mark.
    const multiple = org.sector === 'technology' ? 14 : org.sector === 'finance' ? 9 : 6;
    if (org.monthlyRevenueUSD > 0) {
      org.valuation = Math.max(org.valuation * 0.97, org.monthlyRevenueUSD * 12 * multiple);
    }

    if (org.cashUSD < 0) {
      org.status = 'dead';
      org.valuation = 0;
      for (const member of team) {
        member.employerId = undefined;
        member.finances.salary *= 0.1;
        member.state.stress = clamp(member.state.stress + 0.25);
        member.state.mood = clamp(member.state.mood - 0.2);
        remember(member, world.t, {
          kind: 'event',
          text: `${org.name} ran out of money and shut down. I'm out of a job.`,
          importance: 0.85,
          valence: -0.8,
        });
      }
      emit(world, {
        category: 'economy',
        title: `${org.name} shut down`,
        detail: `Ran out of runway with ${team.length} people on the team.`,
        agentIds: org.employeeIds,
        orgIds: [org.id],
        cityId: org.cityId,
        importance: 0.8,
      });
    }
  }
}

export function averageSkill(agent: Agent): number {
  const values = Object.values(agent.skills);
  return values.length === 0 ? 0.2 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** 1_250_000 → "1.25M". */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toFixed(0);
}

export function orgsOwnedBy(world: World, agentId: AgentId): Organization[] {
  const agent = world.agents[agentId];
  if (!agent) return [];
  return agent.finances.ownership
    .map((o: { orgId: OrgId }) => world.organizations[o.orgId])
    .filter((o): o is Organization => o != null);
}

export function runwayMonths(org: Organization): number {
  const net = org.monthlyBurnUSD - org.monthlyRevenueUSD;
  if (net <= 0) return Infinity;
  return org.cashUSD / net;
}

/** Age an agent's inventory and holdings — called annually. */
export function depreciate(agent: Agent, _t: SimTime): void {
  for (const item of agent.inventory) item.valueUSD *= 0.82;
}

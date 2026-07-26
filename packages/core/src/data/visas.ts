/**
 * Borders.
 *
 * The most consequential fact about an ambitious person is often which passport
 * they hold. An agent in Bengaluru and an agent in Berlin can have identical
 * skills, identical savings and identical goals, and still face completely
 * different sets of available lives — and a simulation that quietly lets
 * everyone move anywhere is lying about the world it claims to model.
 *
 * Two things are modelled, because they are genuinely separate: the right to
 * **enter** a country, and the right to **work** there. Plenty of people can
 * visit somewhere they could never take a job.
 *
 * The figures are approximations of real regimes as of 2026. They are not legal
 * advice and no simulation should be mistaken for one; they are calibrated to
 * be directionally honest about who finds moving easy and who does not.
 */

/** Fraction of destinations reachable without arranging a visa in advance. */
export const PASSPORT_STRENGTH: Record<string, number> = {
  JP: 0.98, SG: 0.98,
  DE: 0.97, IT: 0.97, ES: 0.97, FR: 0.97, FI: 0.97, KR: 0.97,
  GB: 0.95, US: 0.95, NL: 0.95, SE: 0.95, CH: 0.95, IE: 0.95,
  DK: 0.95, NO: 0.95, AT: 0.95, PT: 0.95, BE: 0.95,
  AU: 0.94, NZ: 0.94, CA: 0.94,
  PL: 0.93, CZ: 0.93, EE: 0.93, HR: 0.92, RO: 0.90,
  IL: 0.90, AE: 0.88, HK: 0.88, TW: 0.85,
  BR: 0.78, AR: 0.78, CL: 0.80, MX: 0.75,
  RS: 0.65, TR: 0.60, ZA: 0.55, RU: 0.55, UA: 0.60,
  CN: 0.50, TH: 0.50, ID: 0.48, PH: 0.40,
  IN: 0.35, VN: 0.35, MA: 0.35,
  KE: 0.32, GH: 0.30, SN: 0.30, TZ: 0.28,
  NG: 0.25, EG: 0.25, ET: 0.22, PK: 0.20, BD: 0.20, LK: 0.28, NP: 0.22,
  SA: 0.45, QA: 0.55, JO: 0.35, LB: 0.25,
};

/** Countries inside the EU/EEA freedom-of-movement area. */
export const FREEDOM_OF_MOVEMENT = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IS', 'IE', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL',
  'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

export interface WorkRegime {
  /** 0 = trivially open, 1 = effectively closed to outsiders. */
  difficulty: number;
  /** Can an employer sponsor someone in? */
  sponsorship: boolean;
  /** Is there a route for the self-funded — a digital-nomad or founder visa? */
  selfFunded: boolean;
  /** Typical out-of-pocket cost in USD. */
  costUSD: number;
  /** Typical wait between applying and being able to start. */
  leadDays: number;
  /** Savings a self-funded route expects to see, in USD. */
  selfFundedSavingsUSD: number;
}

const DEFAULT_REGIME: WorkRegime = {
  difficulty: 0.55,
  sponsorship: true,
  selfFunded: false,
  costUSD: 1200,
  leadDays: 60,
  selfFundedSavingsUSD: 40_000,
};

/**
 * How hard it is for a foreigner to get the right to work, by destination.
 *
 * The United States is the outlier the numbers should make obvious: the richest
 * labour market in the dataset is also the hardest to enter legally, because
 * the main skilled route is a lottery.
 */
export const WORK_REGIME: Record<string, Partial<WorkRegime>> = {
  US: { difficulty: 0.85, costUSD: 5000, leadDays: 180, selfFunded: false },
  GB: { difficulty: 0.70, costUSD: 4200, leadDays: 70, selfFunded: false },
  CH: { difficulty: 0.80, costUSD: 2500, leadDays: 90 },
  AU: { difficulty: 0.62, costUSD: 3200, leadDays: 100 },
  CA: { difficulty: 0.55, costUSD: 2000, leadDays: 120, selfFunded: true, selfFundedSavingsUSD: 60_000 },
  NZ: { difficulty: 0.58, costUSD: 2200, leadDays: 90 },
  JP: { difficulty: 0.60, costUSD: 900, leadDays: 60 },
  KR: { difficulty: 0.62, costUSD: 900, leadDays: 60 },
  SG: { difficulty: 0.58, costUSD: 1500, leadDays: 45 },
  HK: { difficulty: 0.50, costUSD: 1200, leadDays: 45 },
  CN: { difficulty: 0.72, costUSD: 1500, leadDays: 90 },
  IL: { difficulty: 0.68, costUSD: 1800, leadDays: 75 },

  // The EU/EEA — hard from outside, free from inside.
  DE: { difficulty: 0.55, costUSD: 1100, leadDays: 75, selfFunded: true, selfFundedSavingsUSD: 45_000 },
  NL: { difficulty: 0.55, costUSD: 1400, leadDays: 60 },
  FR: { difficulty: 0.60, costUSD: 1200, leadDays: 80 },
  ES: { difficulty: 0.50, costUSD: 1000, leadDays: 70, selfFunded: true, selfFundedSavingsUSD: 32_000 },
  IT: { difficulty: 0.62, costUSD: 1100, leadDays: 100 },
  SE: { difficulty: 0.52, costUSD: 900, leadDays: 70 },
  IE: { difficulty: 0.55, costUSD: 1500, leadDays: 60 },
  PL: { difficulty: 0.45, costUSD: 600, leadDays: 50 },

  // Deliberate open doors — these countries built routes to attract people.
  PT: { difficulty: 0.32, costUSD: 900, leadDays: 60, selfFunded: true, selfFundedSavingsUSD: 22_000 },
  EE: { difficulty: 0.35, costUSD: 500, leadDays: 40, selfFunded: true, selfFundedSavingsUSD: 20_000 },
  AE: { difficulty: 0.30, costUSD: 1600, leadDays: 25, selfFunded: true, selfFundedSavingsUSD: 30_000 },
  TH: { difficulty: 0.45, costUSD: 800, leadDays: 45, selfFunded: true, selfFundedSavingsUSD: 18_000 },

  // Everywhere else in the dataset.
  IN: { difficulty: 0.55, costUSD: 700, leadDays: 60 },
  BR: { difficulty: 0.52, costUSD: 700, leadDays: 70 },
  MX: { difficulty: 0.45, costUSD: 600, leadDays: 50, selfFunded: true, selfFundedSavingsUSD: 18_000 },
  AR: { difficulty: 0.42, costUSD: 500, leadDays: 60 },
  ZA: { difficulty: 0.58, costUSD: 900, leadDays: 90 },
  NG: { difficulty: 0.50, costUSD: 800, leadDays: 60 },
  KE: { difficulty: 0.48, costUSD: 700, leadDays: 50 },
  GH: { difficulty: 0.48, costUSD: 700, leadDays: 50 },
  EG: { difficulty: 0.55, costUSD: 600, leadDays: 70 },
  TR: { difficulty: 0.50, costUSD: 700, leadDays: 60 },
  ID: { difficulty: 0.52, costUSD: 800, leadDays: 60 },
};

export function workRegime(countryCode: string): WorkRegime {
  return { ...DEFAULT_REGIME, ...(WORK_REGIME[countryCode] ?? {}) };
}

export function passportStrength(countryCode: string): number {
  return PASSPORT_STRENGTH[countryCode] ?? 0.4;
}

// ─────────────────────────────────────────────────────────────────────────────

export type MobilityRoute =
  | 'citizen'
  | 'freedom-of-movement'
  | 'sponsored'
  | 'self-funded'
  | 'high-skill'
  | 'blocked';

export interface Mobility {
  /** Whether the agent can take up residence and work at all. */
  allowed: boolean;
  route: MobilityRoute;
  /** Out-of-pocket cost of the paperwork, in USD, on top of moving costs. */
  costUSD: number;
  /** Days between deciding and being able to start. */
  leadDays: number;
  /** Written the way the agent would explain it to a friend. */
  explanation: string;
}

export interface MobilityContext {
  /** The agent's nationality, ISO 3166-1 alpha-2. */
  nationality: string;
  /** Destination country. */
  destination: string;
  /** 0..1 — their strongest relevant skill, which is what a sponsor buys. */
  skill: number;
  /** Reputation, 0..1 — an established name opens doors a CV does not. */
  reputation: number;
  /** Liquid savings in USD, for self-funded routes. */
  savingsUSD: number;
  /** True when an employer in the destination country would sponsor them. */
  hasSponsor: boolean;
}

/**
 * Can this person actually move there, and what would it take?
 *
 * The order of the checks is the order a real person would discover them:
 * you're a citizen, or you have freedom of movement, or someone sponsors you,
 * or you fund yourself, or you're good enough that the country makes an
 * exception — or you can't go.
 */
export function assessMobility(ctx: MobilityContext): Mobility {
  const { nationality, destination } = ctx;

  if (nationality === destination) {
    return { allowed: true, route: 'citizen', costUSD: 0, leadDays: 0, explanation: 'You are a citizen here.' };
  }

  if (FREEDOM_OF_MOVEMENT.has(nationality) && FREEDOM_OF_MOVEMENT.has(destination)) {
    return {
      allowed: true,
      route: 'freedom-of-movement',
      costUSD: 0,
      leadDays: 0,
      explanation: 'Freedom of movement — you can live and work here without asking anyone.',
    };
  }

  const regime = workRegime(destination);

  // A sponsor carries most of the weight, but not all of it: a hard regime is
  // hard even with an employer behind you.
  if (ctx.hasSponsor && regime.sponsorship) {
    const stillHard = regime.difficulty > 0.8 && ctx.skill < 0.55;
    if (!stillHard) {
      return {
        allowed: true,
        route: 'sponsored',
        costUSD: regime.costUSD,
        leadDays: regime.leadDays,
        explanation: `An employer would sponsor you. About $${Math.round(regime.costUSD)} and ${regime.leadDays} days of paperwork.`,
      };
    }
  }

  if (regime.selfFunded && ctx.savingsUSD >= regime.selfFundedSavingsUSD) {
    return {
      allowed: true,
      route: 'self-funded',
      costUSD: regime.costUSD,
      leadDays: Math.round(regime.leadDays * 0.7),
      explanation: `There is a route for people who can support themselves. You have the savings for it — about $${Math.round(regime.costUSD)}.`,
    };
  }

  // The exceptional-talent door. Genuinely narrow, and narrower where the
  // regime is tighter.
  const standing = ctx.skill * 0.6 + ctx.reputation * 0.4;
  if (standing >= 0.55 + regime.difficulty * 0.35) {
    return {
      allowed: true,
      route: 'high-skill',
      costUSD: regime.costUSD * 1.4,
      leadDays: Math.round(regime.leadDays * 1.3),
      explanation: 'Your record is strong enough to qualify on your own merits — slow and expensive, but open.',
    };
  }

  return {
    allowed: false,
    route: 'blocked',
    costUSD: 0,
    leadDays: 0,
    explanation: regime.sponsorship
      ? 'You have no right to work here. You would need an employer willing to sponsor you first.'
      : 'You have no route to live and work here.',
  };
}

/** One clause for the situation report's list of possible destinations. */
export function describeMobility(mobility: Mobility): string {
  switch (mobility.route) {
    case 'citizen':
      return 'home — you can simply move';
    case 'freedom-of-movement':
      return 'no visa needed — you can live and work here';
    case 'sponsored':
      return `needs an employer to sponsor you (~$${Math.round(mobility.costUSD)}, ${mobility.leadDays}d)`;
    case 'self-funded':
      return `open to you via a self-funded visa (~$${Math.round(mobility.costUSD)}, ${mobility.leadDays}d)`;
    case 'high-skill':
      return `possible on your own record (~$${Math.round(mobility.costUSD)}, ${mobility.leadDays}d)`;
    case 'blocked':
      return 'you have no right to work here';
  }
}

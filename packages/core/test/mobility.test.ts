import test from 'node:test';
import assert from 'node:assert/strict';

import { assessMobility, describeMobility, workRegime, passportStrength } from '../src/data/visas.ts';
import { mobilityFor, describePassport } from '../src/mobility.ts';
import { createWorld } from '../src/world.ts';
import { executeAction } from '../src/actions.ts';
import { situationReport, appraise } from '../src/cognition.ts';
import { CITY_BY_ID } from '../src/data/cities.ts';
import { Rng } from '../src/rng.ts';

const base = {
  skill: 0.4,
  reputation: 0.2,
  savingsUSD: 5_000,
  hasSponsor: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// The dataset
// ─────────────────────────────────────────────────────────────────────────────

test('a citizen needs nothing', () => {
  const result = assessMobility({ ...base, nationality: 'GB', destination: 'GB' });
  assert.equal(result.route, 'citizen');
  assert.equal(result.allowed, true);
  assert.equal(result.costUSD, 0);
});

test('freedom of movement applies inside the EU/EEA and not outside it', () => {
  const inside = assessMobility({ ...base, nationality: 'DE', destination: 'PT' });
  assert.equal(inside.route, 'freedom-of-movement');
  assert.equal(inside.costUSD, 0);

  // A British passport lost this exact right, which the dataset should reflect.
  const outside = assessMobility({ ...base, nationality: 'GB', destination: 'PT' });
  assert.notEqual(outside.route, 'freedom-of-movement');
});

test('an unremarkable person with no sponsor and no savings is blocked', () => {
  const result = assessMobility({ ...base, nationality: 'NG', destination: 'US' });
  assert.equal(result.allowed, false);
  assert.equal(result.route, 'blocked');
  assert.match(result.explanation, /sponsor/);
});

test('a sponsor opens most doors, and costs real money and time', () => {
  const result = assessMobility({ ...base, nationality: 'IN', destination: 'DE', hasSponsor: true });
  assert.equal(result.route, 'sponsored');
  assert.ok(result.costUSD > 0);
  assert.ok(result.leadDays > 0);
});

test('the hardest regime resists even a sponsor when the person is ordinary', () => {
  const ordinary = assessMobility({ ...base, nationality: 'IN', destination: 'US', hasSponsor: true, skill: 0.3 });
  assert.equal(ordinary.allowed, false, 'a sponsored but ordinary applicant does not clear a lottery regime');

  const exceptional = assessMobility({ ...base, nationality: 'IN', destination: 'US', hasSponsor: true, skill: 0.8 });
  assert.equal(exceptional.route, 'sponsored');
});

test('countries that built self-funded routes actually have them', () => {
  const portugal = assessMobility({ ...base, nationality: 'BR', destination: 'PT', savingsUSD: 30_000 });
  assert.equal(portugal.route, 'self-funded');

  const tooPoor = assessMobility({ ...base, nationality: 'BR', destination: 'PT', savingsUSD: 3_000 });
  assert.notEqual(tooPoor.route, 'self-funded');

  // The United States has no equivalent, however much money you have.
  const america = assessMobility({ ...base, nationality: 'BR', destination: 'US', savingsUSD: 500_000 });
  assert.notEqual(america.route, 'self-funded');
});

test('an exceptional record opens a door that money and sponsorship did not', () => {
  const result = assessMobility({ ...base, nationality: 'NG', destination: 'GB', skill: 0.95, reputation: 0.9 });
  assert.equal(result.allowed, true);
  assert.equal(result.route, 'high-skill');
  assert.ok(result.costUSD > workRegime('GB').costUSD, 'the exceptional route costs more, not less');
});

test('the same person faces different worlds depending on their passport', () => {
  const german = assessMobility({ ...base, nationality: 'DE', destination: 'NL' });
  const nigerian = assessMobility({ ...base, nationality: 'NG', destination: 'NL' });

  assert.equal(german.allowed, true);
  assert.equal(nigerian.allowed, false);
});

test('passport strength is ordered the way the real index is', () => {
  assert.ok(passportStrength('JP') > passportStrength('GB'));
  assert.ok(passportStrength('GB') > passportStrength('BR'));
  assert.ok(passportStrength('BR') > passportStrength('IN'));
  assert.ok(passportStrength('IN') > passportStrength('PK'));
  assert.ok(passportStrength('ZZ') > 0, 'an unknown country still gets a usable default');
});

test('every route has a human-readable description', () => {
  for (const route of ['citizen', 'freedom-of-movement', 'sponsored', 'self-funded', 'high-skill', 'blocked'] as const) {
    const text = describeMobility({ allowed: route !== 'blocked', route, costUSD: 1000, leadDays: 60, explanation: '' });
    assert.ok(text.length > 0);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Wired into a live world
// ─────────────────────────────────────────────────────────────────────────────

test('owning a company in a country counts as sponsoring yourself into it', () => {
  const world = createWorld({ name: 'visa', seed: 3, cityIds: ['city:london', 'city:berlin'], population: 1 });
  const agent = Object.values(world.agents)[0]!;
  agent.nationality = 'IN';
  agent.employerId = undefined;
  agent.finances.ownership = [];

  const before = mobilityFor(world, agent, CITY_BY_ID['city:berlin']!);

  world.organizations['org_x'] = {
    id: 'org_x', name: 'Acme', kind: 'startup', cityId: 'city:berlin',
    founderIds: [agent.id], employeeIds: [agent.id], foundedAt: 0,
    valuation: 1_000_000, cashUSD: 100_000, monthlyBurnUSD: 1000,
    monthlyRevenueUSD: 500, sector: 'technology', description: '', status: 'active',
  };
  agent.finances.ownership = [{ orgId: 'org_x', fraction: 1 }];

  const after = mobilityFor(world, agent, CITY_BY_ID['city:berlin']!);
  assert.notEqual(before.route, 'sponsored');
  assert.equal(after.route, 'sponsored');
});

test('relocation fails on paperwork before it fails on money', () => {
  const world = createWorld({ name: 'block', seed: 4, cityIds: ['city:lagos', 'city:san-francisco'], population: 1 });
  const agent = Object.values(world.agents)[0]!;
  agent.cityId = 'city:lagos';
  agent.nationality = 'NG';
  agent.employerId = undefined;
  agent.finances.ownership = [];
  agent.skills = { programming: 0.3 };
  agent.reputation.overall = 0.1;
  agent.finances.cash = 500_000_000; // plenty of money; that is not the obstacle

  const outcome = executeAction(world, new Rng(1), agent, 'relocate', { cityId: 'city:san-francisco' }, 'I want out');

  assert.equal(outcome.ok, false);
  assert.equal(agent.cityId, 'city:lagos', 'they did not move');
  assert.match(outcome.summary, /right to work|sponsor/i);
});

test('an agent who is allowed in, and can pay, actually moves', () => {
  const world = createWorld({ name: 'move', seed: 5, cityIds: ['city:berlin', 'city:lisbon'], population: 1 });
  const agent = Object.values(world.agents)[0]!;
  agent.cityId = 'city:berlin';
  agent.nationality = 'DE';
  agent.finances.cash = 200_000;
  agent.finances.currency = 'EUR';

  const outcome = executeAction(world, new Rng(1), agent, 'relocate', { cityId: 'city:lisbon' }, 'cheaper');

  assert.equal(outcome.ok, true);
  assert.equal(agent.cityId, 'city:lisbon');
  assert.equal(agent.finances.currency, 'EUR');
});

test('the situation report tells an agent where it may actually work', () => {
  const world = createWorld({
    name: 'prompt',
    seed: 6,
    cityIds: ['city:lagos', 'city:san-francisco', 'city:london'],
    population: 2,
    agents: [{ name: 'Chidi Adeyemi', cityId: 'city:lagos', goals: ['Leave'] }],
  });
  const agent = Object.values(world.agents).find((a) => a.name === 'Chidi Adeyemi')!;
  agent.nationality = 'NG';
  agent.employerId = undefined;
  agent.finances.ownership = [];
  agent.skills = { programming: 0.2 };
  agent.reputation.overall = 0.05;
  agent.finances.cash = 100;

  const report = situationReport(world, agent, appraise(world, agent));

  assert.ok(report.includes('Immigration:'), 'destinations carry an immigration note');
  assert.match(report, /no right to work here/);
});

test('passports are described in plain language across the range', () => {
  const world = createWorld({ name: 'passport', seed: 7, cityIds: ['city:london'], population: 1 });
  const agent = Object.values(world.agents)[0]!;

  agent.nationality = 'JP';
  assert.match(describePassport(agent), /very strong/);

  agent.nationality = 'IN';
  assert.match(describePassport(agent), /limited/);

  agent.nationality = 'PK';
  assert.match(describePassport(agent), /weak/);
});

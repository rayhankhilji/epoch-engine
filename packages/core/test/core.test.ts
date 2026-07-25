import test from 'node:test';
import assert from 'node:assert/strict';

import { Rng, clamp, drift } from '../src/rng.ts';
import { resetIds } from '../src/ids.ts';
import { boundariesCrossed, localParts, DAY, HOUR } from '../src/time.ts';
import { createWorld } from '../src/world.ts';
import { generateAgent } from '../src/agents.ts';
import { recall, remember, addBelief, learnFact, neighbours, tokenize } from '../src/memory.ts';
import { CITY_BY_ID, haversineKm } from '../src/data/cities.ts';
import { executeAction } from '../src/actions.ts';
import { buyAsset, netWorthUSD, settleMonth, foundOrganization, monthlyBurn } from '../src/economy.ts';
import { interact, ensureRelationship, decayRelationships } from '../src/social.ts';
import { appraise, parseDecision, parseReflection, situationReport } from '../src/cognition.ts';
import { Simulation, mapWithConcurrency } from '../src/simulation.ts';
import type { MindFn } from '../src/types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Determinism
// ─────────────────────────────────────────────────────────────────────────────

test('the PRNG is reproducible from a seed', () => {
  const a = new Rng(42);
  const b = new Rng(42);
  const first = Array.from({ length: 50 }, () => a.next());
  const second = Array.from({ length: 50 }, () => b.next());
  assert.deepEqual(first, second);
});

test('a generator resumes exactly from a serialised state', () => {
  const original = new Rng(7);
  for (let i = 0; i < 10; i++) original.next();

  const resumed = Rng.fromState(original.state);
  assert.equal(resumed.next(), new Rng(original.state).next());
});

test('two worlds with the same seed generate identical populations', () => {
  resetIds();
  const a = createWorld({ name: 'A', seed: 1234, cityIds: ['city:london'], population: 12 });
  resetIds();
  const b = createWorld({ name: 'B', seed: 1234, cityIds: ['city:london'], population: 12 });

  const namesA = Object.values(a.agents).map((x) => `${x.name}|${x.age}|${x.occupation}`);
  const namesB = Object.values(b.agents).map((x) => `${x.name}|${x.age}|${x.occupation}`);
  assert.deepEqual(namesA, namesB);
});

test('clamp and drift stay in range', () => {
  assert.equal(clamp(5), 1);
  assert.equal(clamp(-5), 0);
  assert.equal(clamp(5, 0, 10), 5);
  assert.ok(drift(0, 1, 0.5) > 0 && drift(0, 1, 0.5) < 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Time
// ─────────────────────────────────────────────────────────────────────────────

test('boundary detection fires on the right cadences', () => {
  const start = '2026-01-01T00:00:00.000Z';
  assert.equal(boundariesCrossed(start, 0, 30 * 60_000).hour, false);
  assert.equal(boundariesCrossed(start, 0, HOUR).hour, true);
  assert.equal(boundariesCrossed(start, 0, DAY).day, true);
  assert.equal(boundariesCrossed(start, 0, HOUR).day, false);
  assert.equal(boundariesCrossed(start, 0, 32 * DAY).month, true);
  assert.equal(boundariesCrossed(start, 0, 366 * DAY).year, true);
});

test('local time respects the city timezone', () => {
  const start = '2026-06-01T12:00:00.000Z';
  const london = localParts(start, 0, 'Europe/London');
  const tokyo = localParts(start, 0, 'Asia/Tokyo');
  assert.equal(london.hour, 13); // BST
  assert.equal(tokyo.hour, 21);
});

test('an unknown timezone falls back to UTC instead of throwing', () => {
  const parts = localParts('2026-06-01T12:00:00.000Z', 0, 'Not/AZone');
  assert.equal(parts.hour, 12);
});

// ─────────────────────────────────────────────────────────────────────────────
// Geography
// ─────────────────────────────────────────────────────────────────────────────

test('great-circle distances are approximately right', () => {
  const km = haversineKm(CITY_BY_ID['city:london']!, CITY_BY_ID['city:new-york']!);
  assert.ok(km > 5400 && km < 5700, `expected ~5570 km, got ${km}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Memory
// ─────────────────────────────────────────────────────────────────────────────

test('recall surfaces relevant memories ahead of irrelevant ones', () => {
  const rng = new Rng(3);
  const agent = generateAgent(rng, { city: CITY_BY_ID['city:london']! });

  remember(agent, 0, { kind: 'observation', text: 'I ate a sandwich at my desk.', importance: 0.1 });
  remember(agent, 0, { kind: 'event', text: 'My startup ran out of funding and I had to lay off the team.', importance: 0.9 });
  remember(agent, 0, { kind: 'observation', text: 'The weather was grey again.', importance: 0.1 });

  const recalled = recall(agent, HOUR, 'funding startup money', 2);
  assert.ok(recalled.some((m) => m.text.includes('funding')), 'the funding memory should surface');
});

test('recall marks retrieved memories as accessed', () => {
  const agent = generateAgent(new Rng(4), { city: CITY_BY_ID['city:berlin']! });
  remember(agent, 0, { kind: 'observation', text: 'Learned about distributed systems.', importance: 0.5 });

  const [entry] = recall(agent, HOUR, 'distributed systems', 1);
  assert.ok(entry);
  assert.equal(entry.accessCount, 1);
  assert.equal(entry.lastAccessedAt, HOUR);
});

test('the memory stream compacts rather than growing without bound', () => {
  const agent = generateAgent(new Rng(5), { city: CITY_BY_ID['city:berlin']! });
  for (let i = 0; i < 900; i++) {
    remember(agent, i * HOUR, { kind: 'observation', text: `Ordinary moment number ${i}.`, importance: 0.05 });
  }
  assert.ok(agent.memory.stream.length <= 600, `stream grew to ${agent.memory.stream.length}`);
});

test('near-duplicate beliefs reinforce instead of duplicating', () => {
  const agent = generateAgent(new Rng(6), { city: CITY_BY_ID['city:london']! });
  addBelief(agent, 0, 'I hate owing people money', 0.6, 'money');
  addBelief(agent, HOUR, 'I hate owing people money', 0.8, 'money');
  assert.equal(agent.memory.beliefs.length, 1);
  assert.ok(agent.memory.beliefs[0]!.confidence > 0.6);
});

test('the knowledge graph links facts and reads back neighbours', () => {
  const agent = generateAgent(new Rng(7), { city: CITY_BY_ID['city:london']! });
  learnFact(
    agent.memory.graph,
    { id: agent.id, label: agent.name, type: 'person' },
    'founded',
    { id: 'org:acme', label: 'Acme', type: 'org' },
    0.8,
  );
  const linked = neighbours(agent.memory.graph, agent.id);
  assert.equal(linked.length, 1);
  assert.equal(linked[0]!.node!.label, 'Acme');
  assert.equal(linked[0]!.relation, 'founded');
});

test('tokenize strips stopwords and short tokens', () => {
  assert.deepEqual(tokenize('I have been to the bank'), ['bank']);
});

// ─────────────────────────────────────────────────────────────────────────────
// Agents & society
// ─────────────────────────────────────────────────────────────────────────────

test('generated agents are internally coherent', () => {
  const rng = new Rng(99);
  for (let i = 0; i < 200; i++) {
    const agent = generateAgent(rng, { city: CITY_BY_ID['city:lagos']! });
    assert.ok(agent.age >= 18 && agent.age <= 68);
    assert.ok(agent.iq >= 65 && agent.iq <= 165);
    assert.equal(agent.finances.currency, 'NGN');
    for (const value of Object.values(agent.personality)) {
      assert.ok(value >= 0 && value <= 1, 'personality facets stay normalised');
    }
    assert.ok(agent.finances.cash >= 0, 'nobody starts with negative cash');
  }
});

test('relationships are directed and update asymmetrically', () => {
  const world = createWorld({ name: 'social', seed: 5, cityIds: ['city:london'], population: 2 });
  const [a, b] = Object.values(world.agents);
  assert.ok(a && b);

  // Force a large personality gap so the two sides respond differently.
  a.personality.neuroticism = 0.95;
  a.personality.agreeableness = 0.1;
  b.personality.neuroticism = 0.05;
  b.personality.agreeableness = 0.95;
  a.relationships = {};
  b.relationships = {};

  interact(world, new Rng(1), a, b, { quality: -0.8, summary: 'A bad argument.' });

  const fromA = a.relationships[b.id]!;
  const fromB = b.relationships[a.id]!;
  assert.ok(fromA.affinity < fromB.affinity, 'the neurotic, disagreeable side should take it harder');
});

test('relationships decay without contact', () => {
  const world = createWorld({ name: 'decay', seed: 8, cityIds: ['city:london'], population: 2 });
  const [a, b] = Object.values(world.agents);
  const rel = ensureRelationship(a!, b!, 0);
  rel.familiarity = 0.8;
  rel.lastContactAt = 0;

  world.t = 30 * DAY;
  for (let i = 0; i < 30; i++) decayRelationships(world);
  assert.ok(rel.familiarity < 0.8, 'familiarity should fade');
});

// ─────────────────────────────────────────────────────────────────────────────
// Economy
// ─────────────────────────────────────────────────────────────────────────────

test('buying an asset moves cash into a position', () => {
  const world = createWorld({ name: 'econ', seed: 11, cityIds: ['city:new-york'], population: 1 });
  const agent = Object.values(world.agents)[0]!;
  agent.finances.cash = 10_000;
  agent.finances.currency = 'USD';
  agent.finances.holdings = []; // agents can be generated holding assets already
  world.market.quotes['AAPL'] = { symbol: 'AAPL', name: 'Apple', price: 200, changePct: 0, currency: 'USD', kind: 'stock', fetchedAt: 0 };

  const result = buyAsset(world, agent, 'AAPL', 2000);
  assert.equal(result.ok, true);
  assert.equal(agent.finances.cash, 8000);
  assert.equal(agent.finances.holdings[0]!.quantity, 10);
});

test('buying more of an existing position averages the cost basis', () => {
  const world = createWorld({ name: 'econ-avg', seed: 11, cityIds: ['city:new-york'], population: 1 });
  const agent = Object.values(world.agents)[0]!;
  agent.finances.cash = 10_000;
  agent.finances.currency = 'USD';
  agent.finances.holdings = [{ symbol: 'AAPL', kind: 'stock', quantity: 10, costBasis: 100 }];
  world.market.quotes['AAPL'] = { symbol: 'AAPL', name: 'Apple', price: 200, changePct: 0, currency: 'USD', kind: 'stock', fetchedAt: 0 };

  buyAsset(world, agent, 'AAPL', 2000);

  const holding = agent.finances.holdings[0]!;
  assert.equal(holding.quantity, 20);
  assert.equal(holding.costBasis, 150); // (10*100 + 10*200) / 20
});

test('an agent cannot buy an asset with money it does not have', () => {
  const world = createWorld({ name: 'econ2', seed: 12, cityIds: ['city:new-york'], population: 1 });
  const agent = Object.values(world.agents)[0]!;
  agent.finances.cash = 0;
  agent.finances.currency = 'USD';
  world.market.quotes['AAPL'] = { symbol: 'AAPL', name: 'Apple', price: 200, changePct: 0, currency: 'USD', kind: 'stock', fetchedAt: 0 };

  const result = buyAsset(world, agent, 'AAPL', 5000);
  assert.equal(result.ok, false);
  assert.equal(agent.finances.holdings.length, 0);
});

test('overspending an entire month converts into real, expensive debt', () => {
  const world = createWorld({ name: 'debt', seed: 13, cityIds: ['city:zurich'], population: 1 });
  const agent = Object.values(world.agents)[0]!;
  agent.finances.cash = 0;
  agent.finances.salary = 0;
  agent.finances.debts = [];
  assert.ok(monthlyBurn(agent, world.cities[agent.cityId]) > 0);

  settleMonth(world, new Rng(1));

  assert.ok(agent.finances.debts.length > 0, 'a shortfall should become debt');
  assert.equal(agent.finances.cash, 0);
  assert.ok(agent.finances.debts[0]!.rate > 0.2, 'emergency credit is punitive');
});

test('founding a company transfers savings and grants full ownership', () => {
  const world = createWorld({ name: 'found', seed: 14, cityIds: ['city:san-francisco'], population: 1 });
  const agent = Object.values(world.agents)[0]!;
  agent.finances.cash = 50_000;
  agent.finances.currency = 'USD';

  const org = foundOrganization(world, agent, { name: 'Acme', sector: 'technology', description: 'Testing.' });
  assert.equal(agent.finances.ownership[0]!.orgId, org.id);
  assert.equal(agent.finances.ownership[0]!.fraction, 1);
  assert.ok(agent.finances.cash < 50_000, 'the founder capitalises the company');
  assert.ok(netWorthUSD(world, agent) > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

test('an action an agent cannot afford fails without corrupting state', () => {
  const world = createWorld({ name: 'act', seed: 15, cityIds: ['city:london', 'city:tokyo'], population: 1 });
  const agent = Object.values(world.agents)[0]!;
  agent.cityId = 'city:london';
  agent.finances.cash = 0;

  const before = agent.finances.cash;
  const outcome = executeAction(world, new Rng(1), agent, 'travel', { cityId: 'city:tokyo' }, 'I want to go');

  assert.equal(outcome.ok, false);
  assert.equal(agent.finances.cash, before);
  assert.equal(agent.cityId, 'city:london', 'a failed flight should not teleport anyone');
});

test('meeting someone on another continent fails', () => {
  const world = createWorld({ name: 'meet', seed: 16, cityIds: ['city:london', 'city:tokyo'], population: 4 });
  const agents = Object.values(world.agents);
  const a = agents[0]!;
  const b = agents[1]!;
  a.cityId = 'city:london';
  b.cityId = 'city:tokyo';

  const outcome = executeAction(world, new Rng(1), a, 'meet', { agentId: b.id }, 'catch up');
  assert.equal(outcome.ok, false);
});

test('every executed action leaves a memory behind', () => {
  const world = createWorld({ name: 'trace', seed: 17, cityIds: ['city:london'], population: 1 });
  const agent = Object.values(world.agents)[0]!;
  const before = agent.memory.stream.length;
  executeAction(world, new Rng(1), agent, 'rest', {}, 'tired');
  assert.equal(agent.memory.stream.length, before + 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Cognition
// ─────────────────────────────────────────────────────────────────────────────

test('appraisal escalates when an agent is about to run out of money', () => {
  const world = createWorld({ name: 'appraise', seed: 18, cityIds: ['city:london'], population: 1 });
  const agent = Object.values(world.agents)[0]!;
  agent.finances.cash = 0;
  agent.finances.salary = 0;
  agent.state.energy = 0.9;
  agent.state.health = 0.9;
  agent.state.stress = 0.2;

  const appraisal = appraise(world, agent);
  assert.ok(appraisal.salience > 0.5);
  assert.match(appraisal.trigger, /money|month/);
});

test('a malformed model response degrades to a safe decision', () => {
  assert.equal(parseDecision(null).action, 'idle');
  assert.equal(parseDecision({ action: 'launch_missiles' }).action, 'idle');
  assert.deepEqual(parseDecision({ action: 'rest', args: 'not-an-object' }).args, {});
  assert.equal(parseDecision({ action: 'rest', expectedValue: 99 }).expectedValue, 1);
});

test('a malformed reflection response degrades safely', () => {
  const parsed = parseReflection({ beliefs: 'nope', goalUpdates: null, mood: 'high' });
  assert.deepEqual(parsed.beliefs, []);
  assert.deepEqual(parsed.goalUpdates, []);
  assert.equal(parsed.mood, 0.5);
});

test('the situation report contains what an agent needs to decide', () => {
  const world = createWorld({
    name: 'prompt',
    seed: 19,
    cityIds: ['city:london'],
    population: 3,
    agents: [{ name: 'Ada Byron', cityId: 'city:london', occupation: 'Founder', goals: ['Build a unicorn'] }],
  });
  const ada = Object.values(world.agents).find((a) => a.name === 'Ada Byron')!;
  const report = situationReport(world, ada, appraise(world, ada));

  for (const section of ['# You', '# Right now', '# Money', '# What you want', '# What you can do with this hour']) {
    assert.ok(report.includes(section), `report should contain "${section}"`);
  }
  assert.ok(report.includes('Build a unicorn'));
  assert.ok(report.includes('London'));
});

// ─────────────────────────────────────────────────────────────────────────────
// Simulation
// ─────────────────────────────────────────────────────────────────────────────

test('concurrency is genuinely bounded', async () => {
  let inFlight = 0;
  let peak = 0;
  const items = Array.from({ length: 50 }, (_, i) => i);

  await mapWithConcurrency(items, 5, async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight--;
  });

  assert.ok(peak <= 5, `peak concurrency was ${peak}`);
});

test('a simulation advances time and drives agents through their minds', async () => {
  const world = createWorld({
    name: 'run',
    seed: 20,
    startISO: '2026-03-01T08:00:00.000Z',
    cityIds: ['city:london'],
    population: 3,
    minutesPerTick: 30,
    liveData: false,
  });

  let calls = 0;
  const mind: MindFn = async (request) => {
    calls++;
    if (request.kind === 'act') {
      return { data: { action: 'work', args: {}, reasoning: 'There is work to do.', expectedValue: 0.6 } } as never;
    }
    if (request.kind === 'reflect') {
      return { data: { beliefs: [{ statement: 'Work is how I get there.', confidence: 0.7, topic: 'work' }], goalUpdates: [], mood: 0.6 } } as never;
    }
    return { data: { strategy: 'Keep going.', horizonDays: 30, steps: [{ summary: 'Work', action: 'work', expectedValue: 0.5 }] } } as never;
  };

  const sim = new Simulation({ world, mind });
  await sim.run(6); // three simulated hours
  sim.dispose();

  assert.ok(world.t > 0);
  assert.ok(calls > 0, 'agents should have thought');
  assert.ok(world.stats.decisions > 0);
  assert.equal(world.stats.llmCalls, calls);
});

test('a mind that throws does not stop the world', async () => {
  const world = createWorld({ name: 'resilient', seed: 21, cityIds: ['city:london'], population: 2, minutesPerTick: 60, liveData: false });
  const warnings: string[] = [];

  const sim = new Simulation({
    world,
    mind: async () => {
      throw new Error('provider exploded');
    },
    onWarning: (message) => warnings.push(message),
  });

  await sim.run(2);
  sim.dispose();

  assert.ok(world.t > 0, 'time still advanced');
  assert.ok(warnings.length > 0, 'the failure was surfaced rather than swallowed');
});

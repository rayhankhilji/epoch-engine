/**
 * Headless runner.
 *
 *   npm run sim -- --scenario unicorn --days 30
 *   npm run sim -- --scenario agi --days 90 --provider anthropic --seed 7
 *   npm run sim -- --list
 *
 * Prints the world's timeline as it happens, then a summary of who ended up
 * where — and what the whole thing cost you.
 */

import { loadEnv } from './env.ts';
loadEnv();

import {
  Simulation,
  createWorld,
  formatCompact,
  netWorthUSD,
  onEvent,
  stamp,
  type WorldEvent,
} from '@epoch/core';
import { createMind, formatUSD, isKeyless, providerStatus } from '@epoch/llm';
import { createWorldData } from '@epoch/world';
import { SCENARIOS, estimateCostUSD, getScenario } from './scenarios.ts';
import { Store } from './store.ts';

const c = {
  dim: (t: string) => `\u001b[2m${t}\u001b[0m`,
  bold: (t: string) => `\u001b[1m${t}\u001b[0m`,
  red: (t: string) => `\u001b[31m${t}\u001b[0m`,
  green: (t: string) => `\u001b[32m${t}\u001b[0m`,
  yellow: (t: string) => `\u001b[33m${t}\u001b[0m`,
  blue: (t: string) => `\u001b[34m${t}\u001b[0m`,
  magenta: (t: string) => `\u001b[35m${t}\u001b[0m`,
  cyan: (t: string) => `\u001b[36m${t}\u001b[0m`,
};

const CATEGORY_COLOUR: Record<string, (t: string) => string> = {
  life: c.magenta,
  career: c.blue,
  economy: c.green,
  social: c.cyan,
  travel: c.yellow,
  health: c.red,
  world: c.bold,
  cognition: c.dim,
  system: c.dim,
};

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  usage();
  process.exit(0);
}

if (args.list) {
  listScenarios();
  process.exit(0);
}

const scenarioId = String(args.scenario ?? 'unicorn');
const days = Number(args.days ?? 14);
const minImportance = Number(args.minImportance ?? 0.5);
const scenario = getScenario(scenarioId);

if (isKeyless() && !args.force) {
  console.log(
    `\n  ${c.yellow('No API keys are configured.')}\n` +
      `  ${c.dim('Epoch will run on its deterministic mock mind — the mechanics work, but the')}\n` +
      `  ${c.dim('agents are not really reasoning. Add a key to .env for any of:')}\n` +
      providerStatus()
        .filter((p) => p.id !== 'mock' && p.keysUrl)
        .map((p) => `    ${c.dim('·')} ${p.label.padEnd(22)} ${c.dim(p.keysUrl!)}`)
        .join('\n') +
      `\n\n  ${c.dim('Continuing with the mock mind. Pass --force to hide this notice.')}\n`,
  );
}

console.log(
  `\n  ${c.bold(scenario.name)}  ${c.dim(scenario.summary)}\n` +
    `  ${c.dim(`${days} simulated days · seed ${args.seed ?? scenario.seed} · roughly ${scenario.callsPerSimDay * days} model calls`)}\n` +
    `  ${c.dim(`estimated cost if using a mid-tier model: ${formatUSD(estimateCostUSD(scenario, days))}`)}\n`,
);

const world = createWorld({
  ...scenario,
  seed: args.seed != null ? Number(args.seed) : scenario.seed,
  population: args.population != null ? Number(args.population) : scenario.population,
  liveData: args.offline ? false : true,
  minds: args.provider ? [{ provider: String(args.provider) }] : scenario.minds,
});

const mind = createMind({
  onWarning: (message) => {
    if (args.verbose) console.log(`  ${c.dim(`! ${message}`)}`);
  },
});

const unsubscribe = onEvent((event: WorldEvent) => {
  if (event.importance < minImportance) return;
  const colour = CATEGORY_COLOUR[event.category] ?? c.dim;
  const time = c.dim(stamp(world, 'UTC').padEnd(22));
  console.log(`  ${time} ${colour(event.title)}`);
  if (args.verbose && event.detail) console.log(`  ${' '.repeat(22)} ${c.dim(event.detail)}`);
});

const sim = new Simulation({
  world,
  mind: mind.fn,
  data: args.offline ? undefined : createWorldData({ onWarning: () => {} }),
  onWarning: (message) => {
    if (args.verbose) console.log(`  ${c.dim(`! ${message}`)}`);
  },
});

let interrupted = false;
process.on('SIGINT', () => {
  interrupted = true;
  sim.stop();
});

const startedAt = Date.now();
await sim.runDays(days);
unsubscribe();
sim.dispose();

summarise();

if (args.save !== false) {
  const store = new Store();
  const id = `cli-${scenario.id}-${world.config.seed}`;
  store.saveWorld(id, scenario.id, world);
  store.appendEvents(id, world.timeline, 0);
  store.close();
  console.log(`  ${c.dim(`Saved as ${id} — open it in the UI or resume it later.`)}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────

function summarise(): void {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const agents = Object.values(world.agents).filter((a) => a.alive);
  const ranked = [...agents].sort((a, b) => netWorthUSD(world, b) - netWorthUSD(world, a));

  console.log(
    `\n  ${c.bold(interrupted ? 'Interrupted' : 'Done')} ${c.dim(
      `· ${world.stats.simDays} sim-days in ${elapsed}s real time`,
    )}\n`,
  );

  console.log(`  ${c.bold('Where everyone ended up')}`);
  for (const agent of ranked.slice(0, 12)) {
    const goal = agent.goals.filter((g) => g.status === 'active').sort((a, b) => b.priority - a.priority)[0];
    const city = world.cities[agent.cityId]?.name ?? 'nowhere';
    const worth = `$${formatCompact(netWorthUSD(world, agent))}`.padStart(10);
    const progress = goal ? c.dim(`${Math.round(goal.progress * 100)}% · ${goal.title}`) : c.dim('no active goal');
    console.log(`  ${worth}  ${agent.name.padEnd(22)} ${c.dim(`${agent.occupation}, ${city}`.padEnd(34))} ${progress}`);
  }

  const orgs = Object.values(world.organizations).filter((o) => o.status !== 'dead');
  if (orgs.length > 0) {
    console.log(`\n  ${c.bold('Companies founded')}`);
    for (const org of orgs.sort((a, b) => b.valuation - a.valuation).slice(0, 8)) {
      console.log(
        `  ${`$${formatCompact(org.valuation)}`.padStart(10)}  ${org.name.padEnd(22)} ` +
          c.dim(`${org.employeeIds.length} people · ${world.cities[org.cityId]?.name ?? ''}`),
      );
    }
  }

  const achieved = Object.values(world.agents).flatMap((agent) =>
    agent.goals.filter((g) => g.status === 'achieved').map((g) => `${agent.name}: ${g.title}`),
  );
  if (achieved.length > 0) {
    console.log(`\n  ${c.bold('Goals achieved')}`);
    for (const line of achieved) console.log(`  ${c.green('✓')} ${line}`);
  }

  console.log(
    `\n  ${c.bold('Cognition')}\n` +
      `  ${world.stats.decisions} decisions · ${mind.stats.calls} model calls · ` +
      `${mind.stats.inputTokens.toLocaleString()} in / ${mind.stats.outputTokens.toLocaleString()} out · ` +
      c.green(formatUSD(mind.stats.costUSD)),
  );

  for (const [provider, usage] of Object.entries(mind.stats.byProvider)) {
    console.log(`  ${c.dim('·')} ${provider.padEnd(12)} ${String(usage.calls).padStart(5)} calls  ${c.dim(formatUSD(usage.costUSD))}`);
  }

  if (mind.stats.retries > 0 || mind.stats.fallbacks > 0 || mind.stats.parseFailures > 0) {
    console.log(
      c.dim(
        `  ${mind.stats.retries} retries · ${mind.stats.fallbacks} provider fallbacks · ${mind.stats.parseFailures} unparseable responses`,
      ),
    );
  }
  console.log('');
}

function listScenarios(): void {
  console.log(`\n  ${c.bold('Scenarios')}\n`);
  for (const entry of SCENARIOS) {
    console.log(`  ${c.bold(entry.id.padEnd(14))} ${entry.summary}`);
    console.log(
      `  ${' '.repeat(14)} ${c.dim(
        `${entry.population ?? 0} agents · ${entry.cityIds?.length ?? 'all'} cities · ~${entry.callsPerSimDay} calls per sim-day`,
      )}\n`,
    );
  }
}

function usage(): void {
  console.log(`
  ${c.bold('epoch sim')} — run a world in the terminal

  ${c.dim('Options')}
    --scenario <id>     which scenario to run        ${c.dim('(default: unicorn)')}
    --days <n>          simulated days to run        ${c.dim('(default: 14)')}
    --provider <id>     force one provider for all agents
    --seed <n>          override the scenario's seed
    --population <n>    override the background population
    --minImportance <n> only print events above this  ${c.dim('(default: 0.5)')}
    --offline           skip all live world data
    --no-save           don't write the world to the database
    --verbose           show event detail and provider warnings
    --list              list available scenarios
`);
}

function parseArgs(argv: string[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith('--')) continue;

    const key = token.slice(2);
    if (key.startsWith('no-')) {
      out[key.slice(3)] = false;
      continue;
    }

    const next = argv[i + 1];
    if (next == null || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

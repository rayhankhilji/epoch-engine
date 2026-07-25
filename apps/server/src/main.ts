/**
 * Epoch server entry point.
 *
 *   npm run dev     — start the API on :8787
 *   npm run sim     — run a world headless in the terminal
 */

import { loadEnv } from './env.ts';
loadEnv();

import { configuredProviders, isKeyless, providerStatus } from '@epoch/llm';
import { SOURCES } from '@epoch/world';
import { Store } from './store.ts';
import { Runtime } from './runtime.ts';
import { createApi } from './api.ts';
import { SCENARIOS } from './scenarios.ts';

const store = new Store();
const runtime = new Runtime(store);
const api = createApi({ runtime, store });

const port = await api.listen();

banner(port);

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(0);
    shuttingDown = true;
    process.stdout.write('\n  Pausing and saving every world…\n');
    runtime.shutdown();
    store.close();
    void api.close().then(() => process.exit(0));
  });
}

function banner(activePort: number): void {
  const dim = (text: string) => `\u001b[2m${text}\u001b[0m`;
  const bold = (text: string) => `\u001b[1m${text}\u001b[0m`;
  const green = (text: string) => `\u001b[32m${text}\u001b[0m`;
  const yellow = (text: string) => `\u001b[33m${text}\u001b[0m`;

  const lines: string[] = [
    '',
    `  ${bold('EPOCH')} ${dim('— a simulation engine for intelligence')}`,
    '',
    `  API      ${green(`http://localhost:${activePort}`)}`,
    `  Worlds   ${dim(`${store.listWorlds().length} saved`)}`,
    '',
    `  ${bold('Minds')}`,
  ];

  for (const provider of providerStatus()) {
    const mark = provider.configured ? green('●') : dim('○');
    const detail = provider.configured
      ? dim(`${provider.models.fast} / ${provider.models.standard} / ${provider.models.deep}`)
      : dim(provider.keysUrl ?? 'not configured');
    lines.push(`  ${mark} ${provider.label.padEnd(24)} ${detail}`);
  }

  lines.push('', `  ${bold('World data')} ${dim('— all free, none need a key')}`);
  for (const source of SOURCES) {
    lines.push(`  ${dim('·')} ${source.label.padEnd(24)} ${dim(source.describes)}`);
  }

  lines.push('', `  ${bold('Scenarios')}`);
  for (const scenario of SCENARIOS) {
    lines.push(`  ${dim('·')} ${scenario.id.padEnd(14)} ${dim(scenario.summary)}`);
  }

  if (isKeyless()) {
    lines.push(
      '',
      `  ${yellow('No API keys found.')} Epoch will run on its deterministic mock mind, which`,
      `  ${dim('is enough to see the world turn but is not real reasoning. Copy .env.example')}`,
      `  ${dim('to .env and add a key for any provider above to give the agents real minds.')}`,
    );
  } else {
    lines.push('', `  ${green(`${configuredProviders().length - 1} provider(s) ready.`)} ${dim('Agents will think for real.')}`);
  }

  lines.push('');
  process.stdout.write(lines.join('\n') + '\n');
}

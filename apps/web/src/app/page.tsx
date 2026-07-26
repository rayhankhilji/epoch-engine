'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, usd } from '@/lib/api';
import type { ProviderInfo, Scenario, SourceInfo, StoredWorld, WorldSummary } from '@/lib/types';
import { Button, Chip, Panel, Spinner } from '@/components/ui';

export default function Home() {
  const router = useRouter();

  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [worlds, setWorlds] = useState<{ worlds: WorldSummary[]; stored: StoredWorld[] }>({ worlds: [], stored: [] });
  const [offline, setOffline] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [provider, setProvider] = useState('auto');
  const [liveData, setLiveData] = useState(true);

  useEffect(() => {
    Promise.all([api.scenarios(30), api.providers(), api.sources(), api.worlds()])
      .then(([s, p, src, w]) => {
        setScenarios(s.scenarios);
        setProviders(p.providers);
        setSources(src.sources);
        setWorlds(w);
      })
      .catch(() => setOffline(true));
  }, []);

  const configured = providers.filter((p) => p.configured && p.id !== 'mock');
  const keyless = configured.length === 0;

  async function begin(scenarioId: string) {
    setCreating(scenarioId);
    try {
      const world = await api.createWorld({
        scenarioId,
        provider: provider === 'auto' ? undefined : provider,
        liveData,
        autostart: true,
      });
      router.push(`/w/${world.id}`);
    } catch (error) {
      setCreating(null);
      alert(error instanceof Error ? error.message : String(error));
    }
  }

  if (offline) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-2xl text-ink">The engine isn&rsquo;t running</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            Epoch&rsquo;s server isn&rsquo;t answering on port 8787. Start it with:
          </p>
          <pre className="mt-4 rounded-lg border border-hairline bg-surface px-4 py-3 text-left font-mono text-xs text-ink-secondary">
            npm run dev
          </pre>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Ambient light so the page has depth without an image. */}
      <div
        className="ambient pointer-events-none absolute -top-1/3 left-1/2 h-[70vh] w-[70vw] -translate-x-1/2 rounded-full opacity-60 blur-[120px]"
        style={{ background: 'radial-gradient(circle, rgba(57,135,229,0.20), transparent 65%)' }}
        aria-hidden
      />

      <div className="relative mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <header className="max-w-3xl">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-series-1" />
            <span className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Epoch</span>
          </div>

          <h1 className="mt-6 text-4xl leading-[1.1] text-ink sm:text-6xl">
            A simulation engine
            <br />
            for intelligence.
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-relaxed text-ink-secondary sm:text-lg">
            Hundreds of autonomous agents living inside a persistent world grounded in real Earth — real cities, real
            weather, real markets, real news. You give them a goal. They work out how.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <Chip color="var(--color-series-3)">{sources.length} live data sources, none need a key</Chip>
            <Chip color={keyless ? 'var(--color-warning)' : 'var(--color-good)'}>
              {keyless ? 'no model keys — mock mind' : `${configured.length} provider${configured.length === 1 ? '' : 's'} ready`}
            </Chip>
          </div>
        </header>

        {/* ── Existing worlds ─────────────────────────────────────────────── */}
        {(worlds.worlds.length > 0 || worlds.stored.length > 0) && (
          <section className="mt-14">
            <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">Your worlds</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {worlds.worlds.map((world) => (
                <button
                  key={world.id}
                  onClick={() => router.push(`/w/${world.id}`)}
                  className="group rounded-xl border border-hairline bg-surface/60 p-4 text-left transition-colors hover:border-ink-faint"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink">{world.name}</span>
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${world.status === 'running' ? 'pulse bg-good' : 'bg-ink-faint'}`}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-ink-muted">
                    day {world.stats.simDays} · {world.counts.alive} alive · {usd(world.llm.costUSD)} spent
                  </p>
                </button>
              ))}

              {worlds.stored.map((record) => (
                <button
                  key={record.id}
                  onClick={() => router.push(`/w/${record.id}`)}
                  className="group rounded-xl border border-dashed border-hairline p-4 text-left transition-colors hover:border-ink-faint"
                >
                  <div className="text-sm text-ink-secondary">{record.name}</div>
                  <p className="mt-1 text-[11px] text-ink-faint">
                    saved · {record.agentCount} agents · resume
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── Scenario picker ─────────────────────────────────────────────── */}
        <section className="mt-14">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">Start a world</h2>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[11px] text-ink-muted">
                minds
                <select
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                  className="rounded-md border border-hairline bg-raised px-2 py-1 text-[11px] text-ink-secondary outline-none focus:border-ink-faint"
                >
                  <option value="auto">mixed (scenario default)</option>
                  {providers
                    .filter((p) => p.configured)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                </select>
              </label>

              <label className="flex items-center gap-2 text-[11px] text-ink-muted">
                <input
                  type="checkbox"
                  checked={liveData}
                  onChange={(event) => setLiveData(event.target.checked)}
                  className="accent-[var(--color-series-1)]"
                />
                live world data
              </label>
            </div>
          </div>

          {!scenarios ? (
            <Spinner label="Loading scenarios" />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {scenarios.map((scenario) => (
                <article
                  key={scenario.id}
                  className="group flex flex-col justify-between rounded-xl border border-hairline bg-surface/50 p-5 transition-colors hover:border-ink-faint"
                >
                  <div>
                    <h3 className="text-lg text-ink">{scenario.name}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{scenario.summary}</p>
                    {scenario.description && (
                      <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">{scenario.description}</p>
                    )}
                  </div>

                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Chip>{scenario.population} agents</Chip>
                      <Chip>{scenario.cities} cities</Chip>
                      <Chip color={keyless ? 'var(--color-ink-muted)' : 'var(--color-series-4)'}>
                        {keyless ? 'free (mock)' : `~${usd(scenario.estimatedCostUSD)} / 30 days`}
                      </Chip>
                    </div>

                    <Button variant="primary" onClick={() => begin(scenario.id)} disabled={creating != null}>
                      {creating === scenario.id ? 'Starting…' : 'Begin'}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* ── Provenance ──────────────────────────────────────────────────── */}
        <section className="mt-16 grid gap-4 md:grid-cols-2">
          <Panel title="Minds" bodyClassName="p-4">
            <p className="mb-3 text-[11px] leading-relaxed text-ink-muted">
              Every agent thinks through a real model, chosen per agent — so one world can be a mixed society of Claude,
              GPT and Grok agents. Keys are read from your environment and never leave it.
            </p>
            <ul className="space-y-1.5">
              {providers.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-xs">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: entry.configured ? 'var(--color-good)' : 'var(--color-ink-faint)' }}
                    />
                    <span className={entry.configured ? 'text-ink-secondary' : 'text-ink-faint'}>{entry.label}</span>
                  </span>
                  {entry.configured ? (
                    <span className="truncate text-[10px] text-ink-faint">{entry.models.standard}</span>
                  ) : entry.keysUrl ? (
                    <a
                      href={entry.keysUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-[10px] text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink-secondary"
                    >
                      get a key
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Where the world's facts come from" bodyClassName="p-4">
            <p className="mb-3 text-[11px] leading-relaxed text-ink-muted">
              Every source is free and keyless. When an agent buys a stock, they pay what it actually traded at.
            </p>
            <ul className="space-y-1.5">
              {sources.map((source) => (
                <li key={source.id} className="flex items-center justify-between gap-3">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xs text-ink-secondary underline decoration-dotted underline-offset-2 hover:text-ink"
                  >
                    {source.label}
                  </a>
                  <span className="truncate text-[10px] text-ink-faint">{source.describes}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </section>

        <footer className="mt-16 flex items-center justify-between border-t border-hairline pt-6 text-[11px] text-ink-faint">
          <span>Epoch · MIT licensed</span>
          <a
            href="https://github.com/rayhankhilji/epoch-engine"
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-dotted underline-offset-2 hover:text-ink-secondary"
          >
            github.com/rayhankhilji/epoch-engine
          </a>
        </footer>
      </div>
    </main>
  );
}

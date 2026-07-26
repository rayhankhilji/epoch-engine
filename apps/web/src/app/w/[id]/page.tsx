'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Globe } from '@/components/Globe';
import { EventFeed } from '@/components/EventFeed';
import { AgentPanel } from '@/components/AgentPanel';
import { RelationshipGraph } from '@/components/RelationshipGraph';
import { WealthChart } from '@/components/WealthChart';
import { Button, Chip, Empty, Panel, Spinner, StatTile, Sparkline } from '@/components/ui';
import { api, money, pct, PROVIDER_COLOR, simDate, simTime, usd } from '@/lib/api';
import { usePolled, useStream } from '@/lib/useStream';
import type { AgentDetail, AgentSummary, WorldSummary } from '@/lib/types';

type View = 'globe' | 'network' | 'economy' | 'markets';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'globe', label: 'Earth' },
  { id: 'network', label: 'Society' },
  { id: 'economy', label: 'Economy' },
  { id: 'markets', label: 'Markets' },
];

const SPEEDS = [
  { label: 'Max', delay: 0 },
  { label: 'Fast', delay: 120 },
  { label: 'Slow', delay: 600 },
];

export default function WorldConsole({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [world, setWorld] = useState<WorldSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('globe');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentDetail | null>(null);

  const live = useStream(id);
  const tick = live.tick || world?.tick || 0;

  // Cost over time — sampled from the stream so the sparkline is real history,
  // not a re-fetch.
  const costHistory = useRef<number[]>([]);
  const moodHistory = useRef<number[]>([]);

  useEffect(() => {
    api.world(id).then(setWorld).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  // Re-read the authoritative summary periodically; the stream carries deltas.
  useEffect(() => {
    if (!world) return;
    const timer = setInterval(() => {
      api.world(id).then(setWorld).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [id, world]);

  const { data: agentsData } = usePolled(() => api.agents(id), [id], tick, 20);
  const { data: citiesData } = usePolled(() => api.cities(id), [id], tick, 20);
  const { data: graphData } = usePolled(() => api.graph(id), [id], view === 'network' ? tick : 0, 60);
  const { data: economyData } = usePolled(() => api.economy(id), [id], view === 'economy' ? tick : 0, 30);
  const { data: marketsData } = usePolled(() => api.markets(id), [id], view === 'markets' ? tick : 0, 60);
  const { data: orgsData } = usePolled(() => api.organizations(id), [id], tick, 40);
  const { data: historyEvents } = usePolled(() => api.events(id, { limit: 60, minImportance: 0.4 }), [id], tick, 60);

  const agents = agentsData?.agents ?? [];
  const cities = citiesData?.cities ?? [];

  const status = live.status ?? world?.status ?? 'paused';
  const stats = live.stats ?? world?.stats ?? null;
  const llm = live.llm ?? world?.llm ?? null;

  useEffect(() => {
    if (!llm) return;
    const history = costHistory.current;
    if (history[history.length - 1] !== llm.costUSD) {
      history.push(llm.costUSD);
      if (history.length > 60) history.shift();
    }
  }, [llm]);

  useEffect(() => {
    if (!world) return;
    const history = moodHistory.current;
    history.push(world.mood);
    if (history.length > 60) history.shift();
  }, [world]);

  // Load the selected agent, and refresh them as the world moves.
  useEffect(() => {
    if (!selectedAgentId) {
      setAgent(null);
      return;
    }
    let cancelled = false;
    api
      .agent(id, selectedAgentId)
      .then((detail) => {
        if (!cancelled) setAgent(detail);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, selectedAgentId, Math.floor(tick / 20)]);

  const control = useCallback(
    async (action: 'play' | 'pause' | 'step' | 'speed', extra: { ticks?: number; tickDelayMs?: number } = {}) => {
      try {
        setWorld(await api.control(id, { action, ...extra }));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [id],
  );

  const feedEvents = useMemo(() => {
    const streamed = live.events;
    const historic = historyEvents?.events ?? [];
    const seen = new Set(streamed.map((event) => event.id));
    return [...streamed, ...historic.filter((event) => !seen.has(event.id))].slice(0, 200);
  }, [live.events, historyEvents]);

  const visibleAgents = useMemo(
    () => (selectedCityId ? agents.filter((a) => a.cityId === selectedCityId) : agents),
    [agents, selectedCityId],
  );

  if (error && !world) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="text-center">
          <p className="text-sm text-critical">{error}</p>
          <Link href="/" className="mt-4 inline-block text-xs text-ink-muted underline underline-offset-4">
            Back to scenarios
          </Link>
        </div>
      </main>
    );
  }

  if (!world) return <Spinner label="Opening world" />;

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      {/* ── Command bar ─────────────────────────────────────────────────── */}
      <header className="z-20 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-plane/90 px-4 py-2.5 backdrop-blur">
        <Link href="/" className="text-[11px] uppercase tracking-[0.2em] text-ink-muted transition-colors hover:text-ink">
          Epoch
        </Link>

        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-sm text-ink">{world.name}</h1>
          <span className="tabular shrink-0 text-[11px] text-ink-muted">
            {simDate(world.startISO, live.t || world.t)} · {simTime(world.startISO, live.t || world.t)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${status === 'running' ? 'pulse bg-good' : status === 'error' ? 'bg-critical' : 'bg-ink-faint'}`}
          />
          <span className="text-[11px] capitalize text-ink-muted">{status}</span>
          {!live.connected && <span className="text-[10px] text-warning">reconnecting…</span>}
        </div>

        <div className="flex items-center gap-1">
          {status === 'running' ? (
            <Button onClick={() => control('pause')} title="Pause the world">
              Pause
            </Button>
          ) : (
            <Button variant="primary" onClick={() => control('play')} title="Run the world">
              Play
            </Button>
          )}
          <Button onClick={() => control('step', { ticks: 2 })} disabled={status === 'running'} title="Advance one hour">
            Step
          </Button>
          {SPEEDS.map((speed) => (
            <Button
              key={speed.label}
              onClick={() => control('speed', { tickDelayMs: speed.delay })}
              className={world.tickDelayMs === speed.delay ? 'border-ink-faint text-ink' : ''}
            >
              {speed.label}
            </Button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-4">
          <div className="text-right">
            <div className="tabular text-xs text-ink">{usd(llm?.costUSD ?? 0)}</div>
            <div className="text-[10px] text-ink-muted">{llm?.calls ?? 0} model calls</div>
          </div>
          <div className="text-right">
            <div className="tabular text-xs text-ink">day {stats?.simDays ?? 0}</div>
            <div className="text-[10px] text-ink-muted">{world.counts.alive} alive</div>
          </div>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {/* Below lg the rails stack and the page scrolls; at lg it becomes a
          fixed three-column instrument that never scrolls as a whole. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto p-2 lg:grid-cols-[280px_minmax(0,1fr)_340px] lg:overflow-hidden">
        {/* Left rail: people and places */}
        <div className="flex min-h-0 flex-col gap-2 max-lg:hidden">
          <Panel
            title={selectedCityId ? `${cities.find((c) => c.id === selectedCityId)?.name ?? ''} · people` : 'People'}
            action={
              selectedCityId ? (
                <button onClick={() => setSelectedCityId(null)} className="text-[10px] text-ink-faint hover:text-ink">
                  clear
                </button>
              ) : (
                <span className="tabular text-[10px] text-ink-faint">{agents.length}</span>
              )
            }
            className="flex-[3]"
          >
            {visibleAgents.length === 0 ? (
              <Empty>Nobody here.</Empty>
            ) : (
              <ul className="divide-y divide-hairline">
                {visibleAgents.map((person) => (
                  <li key={person.id}>
                    <button
                      onClick={() => setSelectedAgentId(person.id)}
                      className={`w-full px-3 py-2 text-left transition-colors hover:bg-raised/60 ${
                        selectedAgentId === person.id ? 'bg-raised/80' : ''
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs text-ink">{person.name}</span>
                        <span className="tabular shrink-0 text-[10px] text-ink-muted">{money(person.netWorthUSD)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span
                          className="h-1 w-1 shrink-0 rounded-full"
                          style={{ background: PROVIDER_COLOR[person.provider] ?? 'var(--color-ink-faint)' }}
                          title={`thinking with ${person.provider}`}
                        />
                        <span className="truncate text-[10px] text-ink-faint">
                          {person.occupation} · {person.cityName}
                        </span>
                      </div>
                      {person.topGoal && (
                        <div className="mt-0.5 truncate text-[10px] text-ink-muted">{person.topGoal}</div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Companies" className="flex-[2]">
            {!orgsData || orgsData.organizations.length === 0 ? (
              <Empty>Nobody has founded anything yet.</Empty>
            ) : (
              <ul className="divide-y divide-hairline">
                {orgsData.organizations.slice(0, 12).map((org) => (
                  <li key={org.id} className="px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`truncate text-xs ${org.status === 'dead' ? 'text-ink-faint line-through' : 'text-ink'}`}>
                        {org.name}
                      </span>
                      <span className="tabular shrink-0 text-[10px] text-ink-muted">{org.valuationLabel}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-ink-faint">
                      {org.headcount} people · {org.cityName}
                      {org.runwayMonths != null && org.runwayMonths < 4 && (
                        <span className="text-warning"> · {org.runwayMonths.toFixed(1)}mo runway</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* Centre stage */}
        <div className="flex min-h-0 flex-col gap-2">
          <Panel
            title={
              <nav className="flex gap-1" role="tablist">
                {VIEWS.map((entry) => (
                  <button
                    key={entry.id}
                    role="tab"
                    aria-selected={view === entry.id}
                    onClick={() => setView(entry.id)}
                    className={`rounded px-2 py-0.5 text-[11px] uppercase tracking-[0.14em] transition-colors ${
                      view === entry.id ? 'bg-raised text-ink' : 'text-ink-muted hover:text-ink-secondary'
                    }`}
                  >
                    {entry.label}
                  </button>
                ))}
              </nav>
            }
            action={
              view === 'globe' ? (
                <span className="text-[10px] text-ink-faint">drag to turn · scroll to zoom · click a city</span>
              ) : null
            }
            className="min-h-[420px] flex-[3]"
            bodyClassName="relative overflow-hidden"
          >
            {view === 'globe' && (
              <>
                <Globe cities={cities} agents={agents} selectedCityId={selectedCityId} onSelectCity={setSelectedCityId} />
                <CityCard city={cities.find((c) => c.id === selectedCityId) ?? null} />
              </>
            )}

            {view === 'network' &&
              (graphData ? (
                <RelationshipGraph data={graphData} selectedId={selectedAgentId} onSelect={setSelectedAgentId} />
              ) : (
                <Spinner label="Building the graph" />
              ))}

            {view === 'economy' && (
              <div className="h-full overflow-auto">
                {economyData ? <WealthChart data={economyData} /> : <Spinner label="Measuring wealth" />}
                <div className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-4">
                  <StatTile label="Companies" value={world.counts.organizations} detail={`${stats?.orgsFounded ?? 0} founded`} />
                  <StatTile label="Decisions" value={(stats?.decisions ?? 0).toLocaleString()} detail="made by agents" />
                  <StatTile label="Deaths" value={stats?.deaths ?? 0} detail="since day one" />
                  <StatTile label="Events" value={(stats?.events ?? 0).toLocaleString()} detail="on the timeline" />
                </div>
              </div>
            )}

            {view === 'markets' && (
              <div className="h-full overflow-auto p-4">
                {!marketsData ? (
                  <Spinner label="Fetching markets" />
                ) : marketsData.quotes.length === 0 ? (
                  <Empty>
                    No market data yet — it refreshes once per simulated day, and only when live data is enabled.
                  </Empty>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                      {marketsData.quotes.map((quote) => (
                        <StatTile
                          key={quote.symbol}
                          label={quote.name}
                          value={quote.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          detail={
                            <span className={quote.changePct >= 0 ? 'text-good' : 'text-critical'}>
                              {quote.changePct >= 0 ? '▲' : '▼'} {Math.abs(quote.changePct).toFixed(2)}%
                            </span>
                          }
                          accent={quote.kind === 'crypto' ? 'var(--color-series-4)' : 'var(--color-series-1)'}
                        />
                      ))}
                    </div>

                    {marketsData.news.length > 0 && (
                      <section className="mt-5">
                        <h3 className="mb-2 text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                          What the world is reading
                        </h3>
                        <ul className="space-y-1.5">
                          {marketsData.news.slice(0, 10).map((item) => (
                            <li key={item.id} className="flex items-baseline gap-2">
                              <span className="text-[10px] text-ink-faint">{item.source}</span>
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="truncate text-xs text-ink-secondary underline decoration-dotted underline-offset-2 hover:text-ink"
                              >
                                {item.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                  </>
                )}
              </div>
            )}
          </Panel>

          {/* Vitals */}
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile
              label="Spent"
              value={usd(llm?.costUSD ?? 0)}
              detail={<Sparkline values={costHistory.current} label="cost" color="var(--color-series-4)" />}
              accent="var(--color-series-4)"
            />
            <StatTile
              label="Population mood"
              value={pct(world.mood)}
              detail={<Sparkline values={moodHistory.current} label="mood" color="var(--color-series-3)" />}
              accent="var(--color-series-3)"
            />
            <StatTile
              label="Tokens"
              value={`${((llm?.inputTokens ?? 0) / 1000).toFixed(0)}k in`}
              detail={`${((llm?.outputTokens ?? 0) / 1000).toFixed(1)}k out`}
            />
            <StatTile
              label="Minds"
              value={Object.keys(llm?.byProvider ?? {}).length || 1}
              detail={
                <span className="flex flex-wrap gap-1">
                  {Object.entries(llm?.byProvider ?? {}).map(([provider, usage]) => (
                    <Chip key={provider} color={PROVIDER_COLOR[provider]}>
                      {provider} {usage.calls}
                    </Chip>
                  ))}
                </span>
              }
            />
          </div>
        </div>

        {/* Right rail: the feed, or whoever you selected */}
        <div className="flex min-h-0 flex-col gap-2">
          {selectedAgentId ? (
            <Panel
              title="Agent"
              action={
                <button onClick={() => setSelectedAgentId(null)} className="text-[10px] text-ink-faint hover:text-ink">
                  close
                </button>
              }
              className="min-h-[420px] flex-1 lg:min-h-0"
              bodyClassName="p-0"
            >
              <AgentPanel agent={agent} startISO={world.startISO} onSelectAgent={setSelectedAgentId} />
            </Panel>
          ) : (
            <Panel
              title="Timeline"
              action={<span className="tabular text-[10px] text-ink-faint">{feedEvents.length}</span>}
              className="min-h-[420px] flex-1 lg:min-h-0"
              bodyClassName="p-0"
            >
              <EventFeed events={feedEvents} startISO={world.startISO} onSelectAgent={setSelectedAgentId} />
            </Panel>
          )}

          {live.warnings.length > 0 && (
            <Panel title="Notices" className="max-h-32 shrink-0" bodyClassName="p-3">
              <ul className="space-y-1">
                {live.warnings.slice(-4).map((warning, index) => (
                  <li key={index} className="text-[10px] leading-relaxed text-warning">
                    {warning}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </main>
  );
}

/** A card that appears over the globe when you pick a city. */
function CityCard({ city }: { city: { name: string; country: string; residents: number; costOfLivingIndex: number; currency: string; medianNetWorthUSD: number; mood: number; organizations: number; weather?: { temperatureC: number; description: string } } | null }) {
  if (!city) return null;

  return (
    <div className="enter pointer-events-none absolute bottom-3 left-3 max-w-[240px] rounded-lg border border-hairline bg-plane/90 p-3 backdrop-blur">
      <h3 className="text-sm text-ink">{city.name}</h3>
      <p className="text-[10px] text-ink-muted">{city.country}</p>
      <dl className="mt-2 space-y-0.5 text-[11px]">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-faint">Residents</dt>
          <dd className="tabular text-ink-secondary">{city.residents}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-faint">Median worth</dt>
          <dd className="tabular text-ink-secondary">{money(city.medianNetWorthUSD)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-faint">Cost of living</dt>
          <dd className="tabular text-ink-secondary">{city.costOfLivingIndex}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-faint">Mood</dt>
          <dd className="tabular text-ink-secondary">{pct(city.mood)}</dd>
        </div>
        {city.weather && (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-faint">Right now</dt>
            <dd className="text-ink-secondary">
              {city.weather.description}, {city.weather.temperatureC.toFixed(0)}°C
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

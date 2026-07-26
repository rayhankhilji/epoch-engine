'use client';

import { useState } from 'react';
import { CATEGORY_COLOR, PROVIDER_COLOR, money, pct, simDate } from '@/lib/api';
import type { AgentDetail } from '@/lib/types';
import { Chip, Empty, Meter, Row, Spinner } from './ui';

type Tab = 'self' | 'mind' | 'money' | 'people' | 'life';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'self', label: 'Self' },
  { id: 'mind', label: 'Mind' },
  { id: 'money', label: 'Money' },
  { id: 'people', label: 'People' },
  { id: 'life', label: 'Life' },
];

/**
 * One person, in full.
 *
 * This is the view that justifies the whole project: not statistics about a
 * population, but what a single agent believes, wants, remembers and owes.
 */
export function AgentPanel({
  agent,
  startISO,
  onSelectAgent,
}: {
  agent: AgentDetail | null;
  startISO: string;
  onSelectAgent?: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('self');

  if (!agent) return <Spinner label="Loading agent" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-hairline px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base leading-tight text-ink">{agent.name}</h2>
            <p className="mt-0.5 truncate text-xs text-ink-muted">
              {agent.age} · {agent.occupation}
              {agent.employer ? ` at ${agent.employer}` : ''} · {agent.cityName}
            </p>
          </div>
          <div className="tabular shrink-0 text-right">
            <div className="text-sm text-ink">{money(agent.netWorthUSD)}</div>
            <div className="text-[10px] text-ink-muted">net worth</div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip color={PROVIDER_COLOR[agent.provider] ?? 'var(--color-ink-muted)'}>
            {agent.provider}
            {agent.model ? ` · ${agent.model}` : ''}
          </Chip>
          <Chip>{agent.education}</Chip>
          <Chip>{agent.politics.label}</Chip>
          {!agent.alive && <Chip color="var(--color-critical)">deceased</Chip>}
          {agent.flight && <Chip color="var(--color-series-4)">in the air</Chip>}
        </div>
      </header>

      {/* ── Body state: always visible, it's the fastest read on someone ── */}
      <div className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-2 border-b border-hairline px-4 py-3">
        <Meter label="energy" value={agent.state.energy} color="var(--color-series-3)" />
        <Meter label="health" value={agent.state.health} color="var(--color-series-3)" />
        <Meter label="stress" value={agent.state.stress} invert />
        <Meter label="mood" value={agent.state.mood} color="var(--color-series-4)" />
        <Meter label="confidence" value={agent.state.confidence} color="var(--color-series-1)" />
        <Meter label="satisfaction" value={agent.state.satisfaction} color="var(--color-series-7)" />
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <nav className="flex shrink-0 gap-1 border-b border-hairline px-2" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={`relative px-2.5 py-2 text-[11px] font-medium transition-colors ${
              tab === entry.id ? 'text-ink' : 'text-ink-muted hover:text-ink-secondary'
            }`}
          >
            {entry.label}
            {tab === entry.id && <span className="absolute inset-x-2 bottom-0 h-px bg-ink" />}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {tab === 'self' && <SelfTab agent={agent} />}
        {tab === 'mind' && <MindTab agent={agent} startISO={startISO} />}
        {tab === 'money' && <MoneyTab agent={agent} />}
        {tab === 'people' && <PeopleTab agent={agent} onSelectAgent={onSelectAgent} />}
        {tab === 'life' && <LifeTab agent={agent} startISO={startISO} />}
      </div>
    </div>
  );
}

/* ── Tabs ─────────────────────────────────────────────────────────────────── */

function SelfTab({ agent }: { agent: AgentDetail }) {
  return (
    <div className="space-y-4">
      <Section title="Personality">
        <div className="grid grid-cols-1 gap-2">
          {Object.entries(agent.personality).map(([trait, value]) => (
            <Meter key={trait} label={trait} value={value} color="var(--color-series-7)" />
          ))}
        </div>
      </Section>

      <Section title="Disposition">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {Object.entries(agent.traits).map(([trait, value]) => (
            <Meter key={trait} label={trait} value={value} color="var(--color-series-1)" />
          ))}
        </div>
      </Section>

      <Section title="Skills">
        {agent.skills.length === 0 ? (
          <p className="text-xs text-ink-faint">Nothing notable yet.</p>
        ) : (
          <div className="space-y-2">
            {agent.skills.slice(0, 10).map((skill) => (
              <Meter key={skill.name} label={skill.name} value={skill.level} color="var(--color-series-3)" />
            ))}
          </div>
        )}
      </Section>

      <Section title="Character">
        <Row label="IQ">{agent.iq}</Row>
        <Row label="Nationality">{agent.nationality}</Row>
        <Row label="Religion">
          {agent.religion.tradition} · {pct(agent.religion.devotion)} devout
        </Row>
        <Row label="Politics">
          {agent.politics.label} ({agent.politics.economic.toFixed(2)} econ, {agent.politics.social.toFixed(2)} social)
        </Row>
        <Row label="Reputation">{pct(agent.reputation.overall)}</Row>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {agent.values.map((value) => (
            <Chip key={value}>{value}</Chip>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {agent.interests.map((interest) => (
            <Chip key={interest} color="var(--color-series-5)">
              {interest}
            </Chip>
          ))}
        </div>
      </Section>
    </div>
  );
}

function MindTab({ agent, startISO }: { agent: AgentDetail; startISO: string }) {
  return (
    <div className="space-y-4">
      <Section title="What they want">
        {agent.goals.length === 0 ? (
          <p className="text-xs text-ink-faint">No goals set.</p>
        ) : (
          <ul className="space-y-2.5">
            {agent.goals.map((goal) => (
              <li key={goal.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-xs ${goal.status === 'active' ? 'text-ink' : 'text-ink-faint line-through'}`}>
                    {goal.title}
                  </span>
                  <span className="tabular shrink-0 text-[10px] text-ink-muted">{pct(goal.progress)}</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-grid">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{
                      width: `${goal.progress * 100}%`,
                      background: goal.terminal ? 'var(--color-series-2)' : 'var(--color-series-1)',
                    }}
                  />
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{goal.rationale}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {agent.plan && (
        <Section title="Current plan">
          <p className="text-xs leading-relaxed text-ink-secondary">{agent.plan.strategy}</p>
          <ol className="mt-2 space-y-1">
            {agent.plan.steps.map((step, index) => (
              <li key={index} className="flex items-start gap-2 text-[11px]">
                <span className={step.done ? 'text-good' : 'text-ink-faint'}>{step.done ? '✓' : '○'}</span>
                <span className={step.done ? 'text-ink-faint line-through' : 'text-ink-secondary'}>{step.summary}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section title="What they believe">
        {agent.beliefs.length === 0 ? (
          <p className="text-xs text-ink-faint">Nothing settled yet — beliefs form through daily reflection.</p>
        ) : (
          <ul className="space-y-2">
            {agent.beliefs.map((belief) => (
              <li key={belief.id}>
                <p className="text-xs leading-relaxed text-ink-secondary">&ldquo;{belief.statement}&rdquo;</p>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-ink-faint">
                  <span className="uppercase tracking-wider">{belief.topic}</span>
                  <span className="tabular">{pct(belief.confidence)} sure</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recent memory">
        <ul className="space-y-2">
          {agent.memories.slice(0, 25).map((memory) => (
            <li key={memory.id} className="flex gap-2">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background:
                    memory.valence > 0.2
                      ? 'var(--color-good)'
                      : memory.valence < -0.2
                        ? 'var(--color-critical)'
                        : 'var(--color-ink-faint)',
                  opacity: 0.4 + memory.importance * 0.6,
                }}
                title={`importance ${pct(memory.importance)}`}
              />
              <div className="min-w-0">
                <p className="text-[11px] leading-relaxed text-ink-secondary">{memory.text}</p>
                <span className="text-[10px] text-ink-faint">
                  {memory.kind} · {simDate(startISO, memory.t)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="What they know">
        <div className="flex flex-wrap gap-1.5">
          {agent.knowledge.nodes.slice(0, 24).map((node) => (
            <Chip key={node.id} color={KNOWLEDGE_COLOR[node.type] ?? 'var(--color-ink-muted)'}>
              {node.label}
            </Chip>
          ))}
        </div>
      </Section>
    </div>
  );
}

const KNOWLEDGE_COLOR: Record<string, string> = {
  person: 'var(--color-series-1)',
  org: 'var(--color-series-2)',
  place: 'var(--color-series-3)',
  concept: 'var(--color-series-7)',
  skill: 'var(--color-series-4)',
  asset: 'var(--color-series-5)',
  event: 'var(--color-series-8)',
};

function MoneyTab({ agent }: { agent: AgentDetail }) {
  const f = agent.finances;
  return (
    <div className="space-y-4">
      <Section title="Position">
        <Row label="Cash">
          {f.cash.toLocaleString(undefined, { maximumFractionDigits: 0 })} {f.currency}
        </Row>
        <Row label="Salary">
          {f.salary.toLocaleString(undefined, { maximumFractionDigits: 0 })} {f.currency}/yr
        </Row>
        <Row label="Monthly burn">
          {f.monthlyBurn.toLocaleString(undefined, { maximumFractionDigits: 0 })} {f.currency}
        </Row>
        <Row label="Runway">
          {f.runwayMonths == null ? (
            <span className="text-good">stable</span>
          ) : (
            <span className={f.runwayMonths < 3 ? 'text-critical' : f.runwayMonths < 6 ? 'text-warning' : ''}>
              {f.runwayMonths.toFixed(1)} months
            </span>
          )}
        </Row>
        <Row label="Net worth">{money(f.netWorthUSD)}</Row>
      </Section>

      {f.ownership.length > 0 && (
        <Section title="Owns">
          {f.ownership.map((stake) => (
            <Row key={stake.orgId} label={stake.name}>
              {pct(stake.fraction)} of {money(stake.valuation)}
            </Row>
          ))}
        </Section>
      )}

      {f.holdings.length > 0 && (
        <Section title="Holdings">
          {f.holdings.map((holding) => (
            <Row key={holding.symbol} label={holding.symbol}>
              {holding.quantity.toFixed(3)} @ {money(holding.costBasis)}
            </Row>
          ))}
        </Section>
      )}

      {f.debts.length > 0 && (
        <Section title="Debts">
          {f.debts.map((debt) => (
            <Row key={debt.id} label={debt.creditor}>
              <span className="text-critical">
                {debt.principal.toLocaleString(undefined, { maximumFractionDigits: 0 })} {f.currency}
              </span>{' '}
              <span className="text-ink-faint">at {(debt.rate * 100).toFixed(0)}%</span>
            </Row>
          ))}
        </Section>
      )}
    </div>
  );
}

function PeopleTab({ agent, onSelectAgent }: { agent: AgentDetail; onSelectAgent?: (id: string) => void }) {
  if (agent.circle.length === 0) return <Empty>They don&rsquo;t know anyone yet.</Empty>;

  return (
    <ul className="space-y-1">
      {agent.circle.map((tie) => (
        <li key={tie.id}>
          <button
            type="button"
            onClick={() => onSelectAgent?.(tie.id)}
            className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-raised/60"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs text-ink">{tie.name}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink-muted">{tie.kind}</span>
            </div>
            <div className="mt-0.5 truncate text-[10px] text-ink-faint">
              {tie.occupation} · {tie.cityName} · {tie.interactions} interactions
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="w-10 text-[10px] text-ink-faint">affinity</span>
              <div className="relative h-1 flex-1 rounded-full bg-grid">
                <div className="absolute inset-y-0 left-1/2 w-px bg-baseline" />
                <div
                  className="absolute inset-y-0 rounded-full"
                  style={{
                    background: tie.affinity >= 0 ? 'var(--color-series-1)' : 'var(--color-critical)',
                    left: tie.affinity >= 0 ? '50%' : `${50 + tie.affinity * 50}%`,
                    width: `${Math.abs(tie.affinity) * 50}%`,
                  }}
                />
              </div>
              <span className="tabular w-8 text-right text-[10px] text-ink-muted">{tie.affinity.toFixed(2)}</span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function LifeTab({ agent, startISO }: { agent: AgentDetail; startISO: string }) {
  if (agent.timeline.length === 0) return <Empty>Nothing has happened to them yet.</Empty>;

  return (
    <ol className="relative space-y-3 border-l border-hairline pl-4">
      {[...agent.timeline].reverse().map((event) => (
        <li key={event.id} className="relative">
          <span
            className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ring-2 ring-surface"
            style={{ background: CATEGORY_COLOR[event.category] ?? 'var(--color-ink-muted)' }}
          />
          <div className="text-[10px] text-ink-faint">{simDate(startISO, event.t)}</div>
          <div className="text-xs text-ink-secondary">{event.title}</div>
          {event.detail && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{event.detail}</p>}
        </li>
      ))}
    </ol>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">{title}</h3>
      {children}
    </section>
  );
}

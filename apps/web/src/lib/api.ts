import type {
  AgentDetail,
  AgentSummary,
  CityInfo,
  GraphData,
  NewsItem,
  OrgInfo,
  ProviderInfo,
  Quote,
  Scenario,
  SourceInfo,
  StoredWorld,
  WealthData,
  WorldEvent,
  WorldSummary,
} from './types';

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`, { cache: 'no-store' });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const api = {
  health: () => get<{ ok: boolean; worlds: number; uptimeSec: number }>('/health'),
  providers: () => get<{ providers: ProviderInfo[] }>('/providers'),
  sources: () => get<{ sources: SourceInfo[] }>('/sources'),
  scenarios: (days = 30) => get<{ scenarios: Scenario[] }>(`/scenarios?days=${days}`),

  worlds: () => get<{ worlds: WorldSummary[]; stored: StoredWorld[] }>('/worlds'),
  world: (id: string) => get<WorldSummary>(`/worlds/${id}`),

  createWorld: (body: {
    scenarioId: string;
    provider?: string;
    seed?: number;
    population?: number;
    liveData?: boolean;
    tickDelayMs?: number;
    stopAfterDays?: number;
    autostart?: boolean;
  }) => send<WorldSummary>('/worlds', 'POST', body),

  deleteWorld: (id: string) => send<{ deleted: string }>(`/worlds/${id}`, 'DELETE'),

  control: (id: string, body: { action: 'play' | 'pause' | 'step' | 'speed'; ticks?: number; tickDelayMs?: number }) =>
    send<WorldSummary>(`/worlds/${id}/control`, 'POST', body),

  agents: (id: string) => get<{ agents: AgentSummary[] }>(`/worlds/${id}/agents`),
  agent: (id: string, agentId: string) => get<AgentDetail>(`/worlds/${id}/agents/${agentId}`),
  cities: (id: string) => get<{ cities: CityInfo[] }>(`/worlds/${id}/cities`),
  organizations: (id: string) => get<{ organizations: OrgInfo[] }>(`/worlds/${id}/organizations`),
  graph: (id: string) => get<GraphData>(`/worlds/${id}/graph`),
  markets: (id: string) =>
    get<{ quotes: Quote[]; fx: Record<string, number>; updatedAt: number; news: NewsItem[] }>(`/worlds/${id}/markets`),
  economy: (id: string) => get<WealthData>(`/worlds/${id}/economy`),

  events: (id: string, options: { limit?: number; minImportance?: number; agentId?: string; category?: string } = {}) => {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.minImportance != null) params.set('minImportance', String(options.minImportance));
    if (options.agentId) params.set('agentId', options.agentId);
    if (options.category) params.set('category', options.category);
    return get<{ events: WorldEvent[] }>(`/worlds/${id}/events?${params}`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────────────────────

export function money(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function usd(value: number): string {
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function compactNumber(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(Math.round(value));
}

/** Sim-milliseconds → a readable date in the world's own calendar. */
export function simDate(startISO: string, t: number): string {
  const date = new Date(Date.parse(startISO) + t);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function simTime(startISO: string, t: number): string {
  const date = new Date(Date.parse(startISO) + t);
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

export function relativeSim(t: number, now: number): string {
  const delta = Math.max(0, now - t);
  const hours = delta / 3_600_000;
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d ago`;
  const months = days / 30;
  return months < 24 ? `${Math.round(months)}mo ago` : `${Math.round(months / 12)}y ago`;
}

/** The one place category → colour is decided, so the whole UI agrees. */
export const CATEGORY_COLOR: Record<string, string> = {
  life: 'var(--color-series-5)',
  career: 'var(--color-series-1)',
  economy: 'var(--color-series-3)',
  social: 'var(--color-series-7)',
  travel: 'var(--color-series-4)',
  health: 'var(--color-series-8)',
  world: 'var(--color-series-2)',
  cognition: 'var(--color-ink-muted)',
  system: 'var(--color-ink-faint)',
};

export const PROVIDER_COLOR: Record<string, string> = {
  anthropic: 'var(--color-series-2)',
  openai: 'var(--color-series-3)',
  xai: 'var(--color-series-1)',
  google: 'var(--color-series-4)',
  groq: 'var(--color-series-5)',
  openrouter: 'var(--color-series-7)',
  ollama: 'var(--color-series-6)',
  mock: 'var(--color-ink-muted)',
};

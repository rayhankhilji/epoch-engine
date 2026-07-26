/**
 * Wire types.
 *
 * The UI is a pure client of the Epoch HTTP API — it never imports the engine.
 * That keeps the browser bundle free of the simulation and means the UI would
 * work just as well against a remote server as a local one.
 */

export interface Scenario {
  id: string;
  name: string;
  summary: string;
  description?: string;
  population: number;
  cities: number | string;
  namedAgents: number;
  callsPerSimDay: number;
  estimatedCostUSD: number;
}

export interface ProviderInfo {
  id: string;
  label: string;
  configured: boolean;
  keysUrl?: string;
  models: { fast: string; standard: string; deep: string };
}

export interface SourceInfo {
  id: string;
  label: string;
  url: string;
  requiresKey: false;
  describes: string;
}

export interface AgentState {
  energy: number;
  health: number;
  stress: number;
  mood: number;
  confidence: number;
  satisfaction: number;
}

export interface AgentSummary {
  id: string;
  name: string;
  age: number;
  occupation: string;
  employer?: string;
  cityId: string;
  cityName: string;
  lat: number;
  lon: number;
  alive: boolean;
  netWorthUSD: number;
  state: AgentState;
  provider: string;
  model?: string;
  topGoal?: string;
  relationships: number;
  flight?: { toCityId: string; toLat: number; toLon: number; arrivesAt: number };
}

export interface Goal {
  id: string;
  title: string;
  rationale: string;
  priority: number;
  progress: number;
  status: 'active' | 'achieved' | 'abandoned' | 'blocked';
  terminal?: boolean;
  deadlineISO?: string | null;
}

export interface Memory {
  id: string;
  t: number;
  kind: string;
  text: string;
  importance: number;
  valence: number;
}

export interface Belief {
  id: string;
  statement: string;
  confidence: number;
  topic: string;
  t: number;
}

export interface Tie {
  id: string;
  name: string;
  occupation: string;
  cityName: string;
  kind: string;
  affinity: number;
  trust: number;
  familiarity: number;
  interactions: number;
}

export interface WorldEvent {
  id: string;
  t: number;
  category: string;
  title: string;
  detail: string;
  agentIds: string[];
  cityId?: string;
  importance: number;
  meta?: Record<string, unknown>;
}

export interface AgentDetail extends AgentSummary {
  gender: string;
  nationality: string;
  education: string;
  iq: number;
  personality: Record<string, number>;
  traits: Record<string, number>;
  values: string[];
  politics: { economic: number; social: number; label: string };
  religion: { tradition: string; devotion: number };
  interests: string[];
  skills: Array<{ name: string; level: number }>;
  averageSkill: number;
  reputation: { overall: number; domains: Record<string, number> };
  finances: {
    currency: string;
    cash: number;
    salary: number;
    monthlyBurn: number;
    runwayMonths: number | null;
    netWorthUSD: number;
    debts: Array<{ id: string; principal: number; rate: number; creditor: string }>;
    holdings: Array<{ symbol: string; kind: string; quantity: number; costBasis: number }>;
    ownership: Array<{ orgId: string; fraction: number; name: string; valuation: number }>;
  };
  goals: Goal[];
  plan: { strategy: string; horizonDays: number; steps: Array<{ summary: string; action: string; done: boolean }> } | null;
  beliefs: Belief[];
  memories: Memory[];
  knowledge: {
    nodes: Array<{ id: string; label: string; type: string; weight: number }>;
    edges: Array<{ from: string; to: string; relation: string; weight: number }>;
  };
  circle: Tie[];
  timeline: WorldEvent[];
}

export interface CityInfo {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  population: number;
  costOfLivingIndex: number;
  currency: string;
  tags: string[];
  residents: number;
  medianNetWorthUSD: number;
  mood: number;
  stress: number;
  organizations: number;
  weather?: { temperatureC: number; description: string; code: number };
}

export interface OrgInfo {
  id: string;
  name: string;
  kind: string;
  cityName: string;
  sector: string;
  description: string;
  status: string;
  valuation: number;
  valuationLabel: string;
  cashUSD: number;
  monthlyRevenueUSD: number;
  monthlyBurnUSD: number;
  runwayMonths: number | null;
  founders: string[];
  headcount: number;
}

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  currency: string;
  kind: string;
}

export interface NewsItem {
  id: string;
  title: string;
  url?: string;
  source: string;
  publishedAt: number;
  topics: string[];
}

export interface LlmStats {
  calls: number;
  failures: number;
  retries: number;
  fallbacks: number;
  parseFailures: number;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  byProvider: Record<string, { calls: number; inputTokens: number; outputTokens: number; costUSD: number }>;
}

export interface WorldSummary {
  id: string;
  scenarioId: string;
  name: string;
  status: 'paused' | 'running' | 'finished' | 'error';
  tickDelayMs: number;
  seed: number;
  startISO: string;
  liveData: boolean;
  t: number;
  tick: number;
  clock: string;
  stats: {
    ticks: number;
    simDays: number;
    decisions: number;
    llmCalls: number;
    events: number;
    deaths: number;
    orgsFounded: number;
  };
  llm: LlmStats;
  counts: { agents: number; alive: number; cities: number; organizations: number; events: number };
  mood: number;
  stress: number;
  marketUpdatedAt: number;
  warnings: string[];
}

export interface StoredWorld {
  id: string;
  name: string;
  scenarioId: string;
  seed: number;
  updatedAt: number;
  simTime: number;
  tick: number;
  agentCount: number;
}

export interface GraphData {
  nodes: Array<{
    id: string;
    name: string;
    cityId: string;
    occupation: string;
    netWorthUSD: number;
    degree: number;
    provider: string;
  }>;
  edges: Array<{ source: string; target: string; kind: string; strength: number; affinity: number }>;
}

export interface WealthData {
  buckets: Array<{ from: number; to: number; count: number }>;
  gini: number;
  total: number;
  median: number;
}

export type StreamMessage =
  | { type: 'open'; worldId: string }
  | { type: 'event'; worldId: string; payload: WorldEvent }
  | { type: 'tick'; worldId: string; payload: { t: number; tick: number; stats: WorldSummary['stats']; llm: LlmStats } }
  | { type: 'status'; worldId: string; payload: { status: WorldSummary['status']; tickDelayMs: number } }
  | { type: 'warning'; worldId: string; payload: { message: string; detail?: unknown } };

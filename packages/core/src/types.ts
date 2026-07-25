/**
 * Epoch — core domain types.
 *
 * Everything in a running world is described by the types in this file.
 * The engine is deliberately data-oriented: a `World` is a plain, serialisable
 * object graph, so any tick can be snapshotted, diffed, replayed or shipped
 * over the wire without special-casing.
 */

export type AgentId = string;
export type OrgId = string;
export type CityId = string;
export type GoalId = string;
export type MemoryId = string;
export type EventId = string;

/** Simulated milliseconds since the world's epoch start. */
export type SimTime = number;

// ─────────────────────────────────────────────────────────────────────────────
// Geography
// ─────────────────────────────────────────────────────────────────────────────

export interface City {
  id: CityId;
  name: string;
  country: string;
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
  lat: number;
  lon: number;
  /** IANA timezone, e.g. "Europe/London". */
  timezone: string;
  population: number;
  /** Numbeo-style index, London = 100. Drives rent, food, everything. */
  costOfLivingIndex: number;
  /** Median gross monthly salary in the local currency. */
  medianSalary: number;
  currency: string;
  /** Free-form tags that shape opportunity: "tech-hub", "finance", "university". */
  tags: string[];
  /** Nearest major airport IATA code, used for travel. */
  airport?: string;
}

export interface Weather {
  cityId: CityId;
  temperatureC: number;
  precipitationMm: number;
  windKph: number;
  code: number;
  description: string;
  observedAt: SimTime;
}

// ─────────────────────────────────────────────────────────────────────────────
// Personality & identity
// ─────────────────────────────────────────────────────────────────────────────

/** All Big Five facets are normalised 0..1. */
export interface BigFive {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

/** Political position on a two-axis compass, each -1..1. */
export interface PoliticalBeliefs {
  /** -1 collectivist / left, +1 free-market / right. */
  economic: number;
  /** -1 libertarian, +1 authoritarian. */
  social: number;
  label: string;
}

export interface ReligiousBeliefs {
  tradition: string;
  /** 0 = purely cultural, 1 = devout. */
  devotion: number;
}

/** Stable dispositions, 0..1. These barely move over a lifetime. */
export interface Traits {
  ambition: number;
  riskTolerance: number;
  discipline: number;
  creativity: number;
  empathy: number;
  charisma: number;
  /** A small stochastic tilt applied to uncertain outcomes. */
  luck: number;
}

/** Volatile inner state, 0..1. These move every hour. */
export interface AgentState {
  energy: number;
  health: number;
  stress: number;
  /** 0 = despairing, 1 = elated. */
  mood: number;
  confidence: number;
  /** How content the agent is with their life trajectory. */
  satisfaction: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Economy
// ─────────────────────────────────────────────────────────────────────────────

export interface Holding {
  /** Ticker ("AAPL"), crypto id ("bitcoin"), or property key ("property:london"). */
  symbol: string;
  kind: 'stock' | 'crypto' | 'property' | 'equity';
  quantity: number;
  /** Average acquisition price in the agent's base currency. */
  costBasis: number;
}

export interface Debt {
  id: string;
  principal: number;
  /** Annual rate, e.g. 0.065. */
  rate: number;
  creditor: string;
  monthlyPayment: number;
}

export interface Finances {
  currency: string;
  cash: number;
  /** Gross annual salary in `currency`. */
  salary: number;
  /** Recurring monthly outgoings, before rent. */
  monthlyExpenses: number;
  holdings: Holding[];
  debts: Debt[];
  /** Organisations the agent owns equity in. */
  ownership: Array<{ orgId: OrgId; fraction: number }>;
}

export interface Organization {
  id: OrgId;
  name: string;
  kind: 'startup' | 'company' | 'nonprofit' | 'lab' | 'university' | 'government' | 'fund';
  cityId: CityId;
  founderIds: AgentId[];
  employeeIds: AgentId[];
  foundedAt: SimTime;
  /** Post-money valuation in USD. */
  valuation: number;
  cashUSD: number;
  monthlyBurnUSD: number;
  monthlyRevenueUSD: number;
  sector: string;
  description: string;
  status: 'active' | 'acquired' | 'dead' | 'public';
}

// ─────────────────────────────────────────────────────────────────────────────
// Social
// ─────────────────────────────────────────────────────────────────────────────

export type RelationshipKind =
  | 'stranger'
  | 'acquaintance'
  | 'friend'
  | 'close-friend'
  | 'partner'
  | 'spouse'
  | 'family'
  | 'colleague'
  | 'mentor'
  | 'mentee'
  | 'rival'
  | 'enemy'
  | 'investor'
  | 'founder-peer';

export interface Relationship {
  with: AgentId;
  kind: RelationshipKind;
  /** -1 hostile … +1 devoted. */
  affinity: number;
  /** 0..1, how much the agent believes what the other says. */
  trust: number;
  /** 0..1, decays without contact. */
  familiarity: number;
  lastContactAt: SimTime | null;
  interactions: number;
  notes: string[];
}

export interface Reputation {
  /** Broad public standing, 0..1. */
  overall: number;
  /** Domain-specific standing, e.g. { engineering: 0.8, politics: 0.2 }. */
  domains: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory
// ─────────────────────────────────────────────────────────────────────────────

export type MemoryKind = 'observation' | 'action' | 'conversation' | 'reflection' | 'plan' | 'event';

/** A single episodic memory in the agent's stream. */
export interface MemoryEntry {
  id: MemoryId;
  t: SimTime;
  kind: MemoryKind;
  text: string;
  /** 0..1 — how much this mattered to the agent when it happened. */
  importance: number;
  /** Emotional valence at encoding, -1..1. */
  valence: number;
  participants: AgentId[];
  cityId?: CityId;
  /** Memories this was derived from (reflections cite their evidence). */
  derivedFrom?: MemoryId[];
  lastAccessedAt: SimTime;
  accessCount: number;
  /** Sparse lexical vector used for relevance scoring — no embedding API needed. */
  terms: Record<string, number>;
}

/** A durable belief distilled from many episodic memories. */
export interface Belief {
  id: MemoryId;
  t: SimTime;
  statement: string;
  /** 0..1 */
  confidence: number;
  evidence: MemoryId[];
  /** Topic tag used for retrieval and for the UI's belief map. */
  topic: string;
}

export interface KnowledgeNode {
  id: string;
  label: string;
  type: 'person' | 'org' | 'place' | 'concept' | 'skill' | 'event' | 'asset';
  /** How strongly the agent holds this node, grows with reinforcement. */
  weight: number;
}

export interface KnowledgeEdge {
  from: string;
  to: string;
  relation: string;
  weight: number;
}

export interface KnowledgeGraph {
  nodes: Record<string, KnowledgeNode>;
  edges: KnowledgeEdge[];
}

export interface MemoryState {
  /** Immediate / episodic stream, newest last. */
  stream: MemoryEntry[];
  /** Long-term distilled beliefs. */
  beliefs: Belief[];
  /** Semantic layer. */
  graph: KnowledgeGraph;
  /** Rolling importance accumulator that triggers reflection. */
  importanceSinceReflection: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Goals & plans
// ─────────────────────────────────────────────────────────────────────────────

export type GoalStatus = 'active' | 'achieved' | 'abandoned' | 'blocked';

export interface Goal {
  id: GoalId;
  title: string;
  /** Why the agent wants this — set by the agent, not the user. */
  rationale: string;
  /** 0..1, relative weight against sibling goals. */
  priority: number;
  /** 0..1, agent's own estimate. */
  progress: number;
  status: GoalStatus;
  createdAt: SimTime;
  /** Optional target date in sim time. */
  deadline?: SimTime;
  /** Set by the scenario author; terminal goals are never abandoned lightly. */
  terminal?: boolean;
  parentId?: GoalId;
}

export interface PlanStep {
  summary: string;
  action: ActionKind;
  /** Best-effort argument bag; validated per action at execution time. */
  args: Record<string, unknown>;
  /** Agent's expected utility for this step, 0..1. */
  expectedValue: number;
  done: boolean;
}

export interface Plan {
  id: string;
  goalId: GoalId;
  /** Human-readable strategy the agent committed to. */
  strategy: string;
  steps: PlanStep[];
  createdAt: SimTime;
  revisedAt: SimTime;
  horizonDays: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

export type ActionKind =
  | 'work'
  | 'study'
  | 'apply_for_job'
  | 'start_business'
  | 'fundraise'
  | 'hire'
  | 'invest'
  | 'sell_asset'
  | 'message'
  | 'call'
  | 'meet'
  | 'socialise'
  | 'publish'
  | 'research'
  | 'travel'
  | 'relocate'
  | 'exercise'
  | 'rest'
  | 'seek_medical_care'
  | 'idle';

/** What an agent's mind returns each hour. */
export interface Decision {
  action: ActionKind;
  args: Record<string, unknown>;
  /** First-person justification, surfaced in the UI. */
  reasoning: string;
  /** Agent's own expected value for this choice, 0..1. */
  expectedValue: number;
  /** Optional: the agent decided to revise its plan this hour. */
  revisePlan?: boolean;
}

export interface ActionOutcome {
  /** Did the action's preconditions hold and did it succeed? */
  ok: boolean;
  /** Narrative summary written to the timeline and the agent's memory. */
  summary: string;
  importance: number;
  valence: number;
  /** Additional agents who should remember this. */
  witnesses?: AgentId[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent
// ─────────────────────────────────────────────────────────────────────────────

/** Which model powers a given agent's mind. Set per-agent by the scenario. */
export interface MindConfig {
  provider: string;
  /** Model id override; otherwise the provider's tier default is used. */
  model?: string;
  temperature?: number;
}

export interface ScheduleBlock {
  /** Minutes from local midnight. */
  startMin: number;
  endMin: number;
  label: string;
  action: ActionKind;
}

export interface InventoryItem {
  name: string;
  quantity: number;
  valueUSD: number;
}

export interface Agent {
  id: AgentId;
  name: string;
  age: number;
  gender: string;
  nationality: string;
  cityId: CityId;

  education: string;
  occupation: string;
  employerId?: OrgId;

  iq: number;
  personality: BigFive;
  traits: Traits;
  values: string[];
  politics: PoliticalBeliefs;
  religion: ReligiousBeliefs;
  interests: string[];
  /** Skill name → proficiency 0..1. */
  skills: Record<string, number>;

  state: AgentState;
  finances: Finances;
  reputation: Reputation;
  relationships: Record<AgentId, Relationship>;

  goals: Goal[];
  plan: Plan | null;
  schedule: ScheduleBlock[];
  inventory: InventoryItem[];
  memory: MemoryState;

  mind: MindConfig;
  alive: boolean;
  /** Set when the agent is mid-flight between cities. */
  travellingTo?: { cityId: CityId; arrivesAt: SimTime };
  /** The action currently occupying the agent, cleared when it completes. */
  currentAction?: { action: ActionKind; until: SimTime; label: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// Events & timeline
// ─────────────────────────────────────────────────────────────────────────────

export type EventCategory =
  | 'life'
  | 'career'
  | 'economy'
  | 'social'
  | 'travel'
  | 'health'
  | 'world'
  | 'cognition'
  | 'system';

export interface WorldEvent {
  id: EventId;
  t: SimTime;
  category: EventCategory;
  /** Short headline for the feed. */
  title: string;
  detail: string;
  agentIds: AgentId[];
  orgIds?: OrgId[];
  cityId?: CityId;
  /** 0..1 — drives feed prominence and whether bystanders notice. */
  importance: number;
  meta?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Markets & news (populated by @epoch/world from free live APIs)
// ─────────────────────────────────────────────────────────────────────────────

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  currency: string;
  kind: 'stock' | 'index' | 'crypto' | 'fx';
  fetchedAt: number;
}

export interface NewsItem {
  id: string;
  title: string;
  url?: string;
  source: string;
  publishedAt: number;
  /** Topic tags used to route the story to interested agents. */
  topics: string[];
}

export interface MarketState {
  quotes: Record<string, Quote>;
  /** USD per unit of currency, e.g. { GBP: 1.27 }. */
  fx: Record<string, number>;
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// World
// ─────────────────────────────────────────────────────────────────────────────

export interface WorldConfig {
  name: string;
  seed: number;
  /** Real-world ISO timestamp the simulation starts from. */
  startISO: string;
  /** Sim-minutes advanced per engine tick. */
  minutesPerTick: number;
  /** Hard cap on concurrent LLM calls during an act phase. */
  maxConcurrentMinds: number;
  /** When false, @epoch/world providers are never contacted. */
  liveData: boolean;
  /** Default mind for agents that don't specify one. */
  defaultMind: MindConfig;
}

export interface World {
  config: WorldConfig;
  /** Sim-milliseconds elapsed since `startISO`. */
  t: SimTime;
  tick: number;
  cities: Record<CityId, City>;
  agents: Record<AgentId, Agent>;
  organizations: Record<OrgId, Organization>;
  weather: Record<CityId, Weather>;
  market: MarketState;
  news: NewsItem[];
  /** Append-only history. The UI reads this backwards. */
  timeline: WorldEvent[];
  /** Serialised PRNG state so a world resumes byte-identically. */
  rngState: number;
  stats: WorldStats;
}

export interface WorldStats {
  ticks: number;
  simDays: number;
  decisions: number;
  llmCalls: number;
  llmTokensIn: number;
  llmTokensOut: number;
  llmCostUSD: number;
  events: number;
  deaths: number;
  orgsFounded: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// The mind contract
//
// `@epoch/core` never imports an SDK. It asks for structured thought through
// this function and `@epoch/llm` supplies an implementation backed by whichever
// providers the user has keys for.
// ─────────────────────────────────────────────────────────────────────────────

export interface MindRequest {
  agentId: AgentId;
  kind: 'act' | 'reflect' | 'plan' | 'speak';
  mind: MindConfig;
  system: string;
  user: string;
  /** JSON Schema the response must satisfy. */
  schema: Record<string, unknown>;
  /** Cheap requests may be routed to a faster tier. */
  tier: 'fast' | 'standard' | 'deep';
}

export interface MindResponse<T = unknown> {
  data: T;
  usage?: { inputTokens: number; outputTokens: number; costUSD: number };
  model?: string;
  provider?: string;
}

export type MindFn = <T = unknown>(req: MindRequest) => Promise<MindResponse<T>>;

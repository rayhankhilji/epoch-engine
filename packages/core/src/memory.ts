/**
 * Three-layer memory.
 *
 *   1. Immediate  — a raw episodic stream of everything the agent experienced.
 *   2. Long-term  — beliefs distilled from that stream by periodic reflection
 *                   ("I hate debt", "startups are how I win").
 *   3. Semantic   — a knowledge graph of people, places, orgs and concepts and
 *                   how they connect.
 *
 * Retrieval is the interesting part. An agent's context window is small and its
 * life is long, so before every decision we score the entire stream on
 *
 *     recency · importance · relevance
 *
 * and hand the model only what surfaces. Relevance is computed lexically with
 * TF-IDF cosine similarity rather than embeddings — that keeps retrieval free,
 * synchronous, offline and deterministic, which matters when you are doing it
 * hundreds of times per simulated hour.
 */

import type {
  Agent,
  Belief,
  KnowledgeGraph,
  MemoryEntry,
  MemoryKind,
  MemoryState,
  SimTime,
  AgentId,
} from './types.ts';
import { nextId } from './ids.ts';
import { HOUR } from './time.ts';
import { clamp } from './rng.ts';

/** Half-life of raw recency, in simulated hours. */
const RECENCY_DECAY_PER_HOUR = 0.995;

/** Beyond this the stream is compacted; low-value memories fade. */
const MAX_STREAM = 600;

/** Accumulated importance that triggers a reflection pass. */
export const REFLECTION_THRESHOLD = 8;

const STOPWORDS = new Set(
  ('a an and are as at be been but by for from had has have he her his i if in into is it its me my of on or ' +
    'she that the their them then there they this to was were what when which who will with you your we us our ' +
    'not no do did does so than too very can could would should about after before over under just')
    .split(' '),
);

// ─────────────────────────────────────────────────────────────────────────────
// Construction
// ─────────────────────────────────────────────────────────────────────────────

export function emptyMemory(): MemoryState {
  return {
    stream: [],
    beliefs: [],
    graph: { nodes: {}, edges: [] },
    importanceSinceReflection: 0,
  };
}

export interface RememberInput {
  kind: MemoryKind;
  text: string;
  /** 0..1. If omitted, estimated from the text and the agent's disposition. */
  importance?: number;
  /** -1..1 emotional colour. */
  valence?: number;
  participants?: AgentId[];
  cityId?: string;
  derivedFrom?: string[];
}

/** Write a memory into an agent's stream. */
export function remember(agent: Agent, t: SimTime, input: RememberInput): MemoryEntry {
  const importance = clamp(input.importance ?? estimateImportance(agent, input.text));
  const entry: MemoryEntry = {
    id: nextId('mem'),
    t,
    kind: input.kind,
    text: input.text,
    importance,
    valence: clamp(input.valence ?? 0, -1, 1),
    participants: input.participants ?? [],
    cityId: input.cityId,
    derivedFrom: input.derivedFrom,
    lastAccessedAt: t,
    accessCount: 0,
    terms: termVector(input.text),
  };

  agent.memory.stream.push(entry);
  agent.memory.importanceSinceReflection += importance;

  // Anyone who was there becomes more salient in the agent's mental model.
  for (const participant of entry.participants) {
    if (participant !== agent.id) reinforce(agent.memory.graph, participant, 'person', 0.05);
  }

  if (agent.memory.stream.length > MAX_STREAM) compact(agent, t);
  return entry;
}

/**
 * Heuristic salience used when the caller has no better estimate. Neurotic
 * agents encode more strongly; mentions of money, death and status score high.
 */
function estimateImportance(agent: Agent, text: string): number {
  const lower = text.toLowerCase();
  let score = 0.25;
  const bumps: Array<[RegExp, number]> = [
    [/\b(died|death|funeral|diagnos|hospital|accident)\b/, 0.45],
    [/\b(married|engaged|divorce|born|baby)\b/, 0.4],
    [/\b(fired|laid off|quit|resigned|promoted|hired)\b/, 0.3],
    [/\b(raised|funding|investment|acquired|ipo|bankrupt)\b/, 0.35],
    [/\b(betray|lied|stole|argument|fight|threat)\b/, 0.3],
    [/\b(million|billion|\$|£|€)\b/, 0.15],
    [/\b(moved|relocat|visa|immigrat)\b/, 0.2],
  ];
  for (const [pattern, bump] of bumps) if (pattern.test(lower)) score += bump;
  // Neuroticism amplifies encoding strength; low openness dampens novelty.
  score *= 0.85 + agent.personality.neuroticism * 0.3;
  return clamp(score);
}

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval
// ─────────────────────────────────────────────────────────────────────────────

export interface RetrievalWeights {
  recency: number;
  importance: number;
  relevance: number;
}

const DEFAULT_WEIGHTS: RetrievalWeights = { recency: 1, importance: 1, relevance: 1.4 };

/**
 * The memories an agent would actually bring to mind when thinking about
 * `query`. Marks retrieved entries as accessed, which slows their decay —
 * memories you revisit stay available, exactly like the real thing.
 */
export function recall(
  agent: Agent,
  t: SimTime,
  query: string,
  limit = 12,
  weights: RetrievalWeights = DEFAULT_WEIGHTS,
): MemoryEntry[] {
  const stream = agent.memory.stream;
  if (stream.length === 0) return [];

  const queryTerms = termVector(query);
  const idf = inverseDocumentFrequency(stream);

  const scored = stream.map((entry) => {
    const hoursSince = Math.max(0, (t - entry.lastAccessedAt) / HOUR);
    const recency = Math.pow(RECENCY_DECAY_PER_HOUR, hoursSince);
    const relevance = cosine(queryTerms, entry.terms, idf);
    const score =
      weights.recency * recency + weights.importance * entry.importance + weights.relevance * relevance;
    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit).map((s) => s.entry);

  for (const entry of top) {
    entry.lastAccessedAt = t;
    entry.accessCount++;
  }
  // Hand them back in chronological order — narrative reads better than ranking.
  return top.sort((a, b) => a.t - b.t);
}

/** The agent's strongest long-term beliefs, optionally filtered by topic. */
export function topBeliefs(agent: Agent, limit = 8, topic?: string): Belief[] {
  return agent.memory.beliefs
    .filter((b) => !topic || b.topic === topic)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

/** True when enough has happened that the agent should stop and reflect. */
export function shouldReflect(agent: Agent): boolean {
  return agent.memory.importanceSinceReflection >= REFLECTION_THRESHOLD;
}

/** Record a distilled belief and reset the reflection accumulator. */
export function addBelief(
  agent: Agent,
  t: SimTime,
  statement: string,
  confidence: number,
  topic: string,
  evidence: string[] = [],
): Belief {
  // Reinforce rather than duplicate when the agent already believes this.
  const existing = agent.memory.beliefs.find((b) => similar(b.statement, statement));
  if (existing) {
    existing.confidence = clamp(existing.confidence * 0.7 + confidence * 0.3 + 0.05);
    existing.t = t;
    existing.evidence = [...new Set([...existing.evidence, ...evidence])].slice(-12);
    return existing;
  }

  const belief: Belief = {
    id: nextId('bel'),
    t,
    statement,
    confidence: clamp(confidence),
    evidence,
    topic,
  };
  agent.memory.beliefs.push(belief);
  if (agent.memory.beliefs.length > 60) {
    agent.memory.beliefs.sort((a, b) => b.confidence - a.confidence);
    agent.memory.beliefs.length = 60;
  }
  return belief;
}

export function clearReflectionDebt(agent: Agent): void {
  agent.memory.importanceSinceReflection = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Semantic layer — the knowledge graph
// ─────────────────────────────────────────────────────────────────────────────

export function reinforce(
  graph: KnowledgeGraph,
  id: string,
  type: KnowledgeGraph['nodes'][string]['type'],
  amount: number,
  label?: string,
): void {
  const existing = graph.nodes[id];
  if (existing) {
    existing.weight = clamp(existing.weight + amount);
    if (label) existing.label = label;
    return;
  }
  graph.nodes[id] = { id, label: label ?? id, type, weight: clamp(amount) };
}

/** Assert `subject —relation→ object`, creating nodes as needed. */
export function learnFact(
  graph: KnowledgeGraph,
  subject: { id: string; label: string; type: KnowledgeGraph['nodes'][string]['type'] },
  relation: string,
  object: { id: string; label: string; type: KnowledgeGraph['nodes'][string]['type'] },
  weight = 0.2,
): void {
  reinforce(graph, subject.id, subject.type, weight, subject.label);
  reinforce(graph, object.id, object.type, weight, object.label);

  const edge = graph.edges.find(
    (e) => e.from === subject.id && e.to === object.id && e.relation === relation,
  );
  if (edge) {
    edge.weight = clamp(edge.weight + weight);
    return;
  }
  graph.edges.push({ from: subject.id, to: object.id, relation, weight: clamp(weight) });
}

/** Everything the agent knows that is directly connected to `id`. */
export function neighbours(graph: KnowledgeGraph, id: string, limit = 10) {
  return graph.edges
    .filter((e) => e.from === id || e.to === id)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((e) => ({
      relation: e.relation,
      node: graph.nodes[e.from === id ? e.to : e.from],
      weight: e.weight,
      direction: e.from === id ? ('out' as const) : ('in' as const),
    }))
    .filter((n) => n.node != null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Compaction — forgetting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drop the least valuable quarter of the stream once it grows too large.
 * Reflections and memories that have been revisited many times survive; trivia
 * from months ago does not. This is what stops a long-running world from
 * growing without bound.
 */
function compact(agent: Agent, t: SimTime): void {
  const stream = agent.memory.stream;
  const keep = Math.floor(MAX_STREAM * 0.75);

  const scored = stream.map((entry) => {
    const ageHours = Math.max(0, (t - entry.t) / HOUR);
    const durability =
      entry.importance * 2 +
      Math.log1p(entry.accessCount) * 0.6 +
      (entry.kind === 'reflection' ? 1.5 : 0) -
      Math.log1p(ageHours) * 0.25;
    return { entry, durability };
  });

  scored.sort((a, b) => b.durability - a.durability);
  const survivors = scored.slice(0, keep).map((s) => s.entry);
  survivors.sort((a, b) => a.t - b.t);
  agent.memory.stream = survivors;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lexical similarity
// ─────────────────────────────────────────────────────────────────────────────

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9£$€\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Term-frequency vector for a piece of text. */
export function termVector(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const tokens = tokenize(text);
  for (const token of tokens) out[token] = (out[token] ?? 0) + 1;
  const max = Math.max(1, ...Object.values(out));
  for (const key of Object.keys(out)) out[key] = out[key]! / max;
  return out;
}

function inverseDocumentFrequency(stream: MemoryEntry[]): Record<string, number> {
  const docFreq: Record<string, number> = {};
  for (const entry of stream) {
    for (const term of Object.keys(entry.terms)) docFreq[term] = (docFreq[term] ?? 0) + 1;
  }
  const n = stream.length || 1;
  const idf: Record<string, number> = {};
  for (const [term, freq] of Object.entries(docFreq)) idf[term] = Math.log(1 + n / (1 + freq));
  return idf;
}

function cosine(
  a: Record<string, number>,
  b: Record<string, number>,
  idf: Record<string, number>,
): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const [term, weight] of Object.entries(a)) {
    const w = weight * (idf[term] ?? 1);
    magA += w * w;
    const other = b[term];
    if (other != null) dot += w * other * (idf[term] ?? 1);
  }
  for (const [term, weight] of Object.entries(b)) {
    const w = weight * (idf[term] ?? 1);
    magB += w * w;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / Math.sqrt(magA * magB);
}

/** Cheap near-duplicate check used to merge beliefs. */
function similar(a: string, b: string): boolean {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return false;
  let shared = 0;
  for (const term of setA) if (setB.has(term)) shared++;
  return shared / Math.min(setA.size, setB.size) > 0.7;
}

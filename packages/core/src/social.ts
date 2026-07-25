/**
 * Society.
 *
 * Relationships are directed and asymmetric — A can trust B far more than B
 * trusts A, which is where most interesting social dynamics come from. Ties
 * strengthen through contact and decay through silence, and reputation
 * propagates through the network rather than being a global scalar.
 */

import type {
  Agent,
  AgentId,
  Relationship,
  RelationshipKind,
  SimTime,
  World,
} from './types.ts';
import { Rng, clamp } from './rng.ts';
import { DAY } from './time.ts';
import { remember, learnFact } from './memory.ts';
import { emit } from './events.ts';

/** Familiarity lost per day without contact. */
const FAMILIARITY_DECAY_PER_DAY = 0.004;

export function getRelationship(agent: Agent, otherId: AgentId): Relationship | undefined {
  return agent.relationships[otherId];
}

export function ensureRelationship(agent: Agent, other: Agent, t: SimTime): Relationship {
  const existing = agent.relationships[other.id];
  if (existing) return existing;

  const relationship: Relationship = {
    with: other.id,
    kind: 'stranger',
    affinity: 0,
    trust: 0.1,
    familiarity: 0,
    lastContactAt: null,
    interactions: 0,
    notes: [],
  };
  agent.relationships[other.id] = relationship;

  learnFact(
    agent.memory.graph,
    { id: agent.id, label: agent.name, type: 'person' },
    'knows',
    { id: other.id, label: other.name, type: 'person' },
    0.1,
  );
  void t;
  return relationship;
}

export interface InteractionInput {
  /** -1 hostile … +1 delightful. */
  quality: number;
  /** What actually happened, written into both agents' memories. */
  summary: string;
  /** Context tag: 'work', 'social', 'romantic', 'business', 'conflict'. */
  context?: string;
  importance?: number;
}

/**
 * Record a two-way interaction. Both sides update, but they update
 * *differently*: an agreeable agent forgives a bad meeting that a neurotic one
 * broods over.
 */
export function interact(
  world: World,
  rng: Rng,
  a: Agent,
  b: Agent,
  input: InteractionInput,
): void {
  const t = world.t;
  const relA = ensureRelationship(a, b, t);
  const relB = ensureRelationship(b, a, t);

  applySide(a, b, relA, input, rng, t);
  applySide(b, a, relB, input, rng, t);

  const importance = input.importance ?? clamp(0.3 + Math.abs(input.quality) * 0.4);
  remember(a, t, { kind: 'conversation', text: input.summary, importance, valence: input.quality, participants: [a.id, b.id], cityId: a.cityId });
  remember(b, t, { kind: 'conversation', text: input.summary, importance, valence: input.quality, participants: [a.id, b.id], cityId: b.cityId });

  if (importance >= 0.55) {
    emit(world, {
      category: 'social',
      title: `${a.name} and ${b.name}`,
      detail: input.summary,
      agentIds: [a.id, b.id],
      cityId: a.cityId,
      importance,
    });
  }
}

function applySide(
  self: Agent,
  other: Agent,
  rel: Relationship,
  input: InteractionInput,
  rng: Rng,
  t: SimTime,
): void {
  // How strongly this lands depends on who is receiving it.
  const sensitivity = 0.6 + self.personality.neuroticism * 0.5;
  const forgiveness = self.personality.agreeableness * 0.4;
  const delta =
    input.quality >= 0
      ? input.quality * 0.14 * sensitivity
      : input.quality * 0.16 * sensitivity * (1 - forgiveness);

  rel.affinity = clamp(rel.affinity + delta, -1, 1);
  rel.trust = clamp(rel.trust + delta * 0.6 + (input.quality > 0 ? 0.01 : -0.02));
  rel.familiarity = clamp(rel.familiarity + 0.06 + rng.float(0, 0.03));
  rel.lastContactAt = t;
  rel.interactions++;
  if (input.summary.length < 220) {
    rel.notes.push(input.summary);
    if (rel.notes.length > 8) rel.notes.shift();
  }

  rel.kind = classify(rel, other, self, rng);

  // Good company lifts mood; hostility raises stress.
  self.state.mood = clamp(self.state.mood + input.quality * 0.05 * self.personality.extraversion);
  if (input.quality < -0.4) self.state.stress = clamp(self.state.stress + 0.05);
}

/** Promote or demote a tie based on where affinity, trust and familiarity sit. */
function classify(rel: Relationship, other: Agent, self: Agent, rng: Rng): RelationshipKind {
  // Structural ties are never overwritten by sentiment.
  if (rel.kind === 'family' || rel.kind === 'spouse' || rel.kind === 'investor') return rel.kind;

  const colleague = self.employerId != null && self.employerId === other.employerId;

  if (rel.affinity <= -0.55 && rel.familiarity > 0.25) return 'enemy';
  if (rel.affinity <= -0.25 && rel.familiarity > 0.2) return 'rival';
  if (rel.affinity >= 0.78 && rel.familiarity >= 0.6) {
    if (rel.kind === 'partner') return 'partner';
    return rng.bool(0.12) && Math.abs(self.age - other.age) < 14 ? 'partner' : 'close-friend';
  }
  if (rel.affinity >= 0.45 && rel.familiarity >= 0.35) return 'friend';
  if (colleague) return 'colleague';
  if (rel.familiarity >= 0.15) return 'acquaintance';
  return 'stranger';
}

/**
 * Ties fade. Run once per simulated day: relationships nobody maintains slide
 * back toward acquaintance, and eventually toward nothing.
 */
export function decayRelationships(world: World): void {
  for (const agent of Object.values(world.agents)) {
    if (!agent.alive) continue;
    for (const rel of Object.values(agent.relationships)) {
      if (rel.lastContactAt == null) continue;
      const daysSince = (world.t - rel.lastContactAt) / DAY;
      if (daysSince < 3) continue;

      rel.familiarity = clamp(rel.familiarity - FAMILIARITY_DECAY_PER_DAY);
      // Affinity drifts toward neutral more slowly than familiarity fades.
      rel.affinity = rel.affinity * 0.9995;

      if (rel.familiarity < 0.08 && rel.kind !== 'family' && rel.kind !== 'spouse') {
        rel.kind = rel.affinity < -0.3 ? 'rival' : 'acquaintance';
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reputation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reputation spreads through the network rather than being assigned globally.
 * When something notable happens, the people who know the agent update first,
 * and their contacts hear a diluted version.
 */
export function propagateReputation(
  world: World,
  subject: Agent,
  domain: string,
  delta: number,
): void {
  subject.reputation.overall = clamp(subject.reputation.overall + delta * 0.4);
  subject.reputation.domains[domain] = clamp((subject.reputation.domains[domain] ?? 0.2) + delta);

  for (const agent of Object.values(world.agents)) {
    if (agent.id === subject.id || !agent.alive) continue;
    const rel = agent.relationships[subject.id];
    if (!rel) continue;
    // People who know you well update their opinion of you the most.
    const weight = 0.3 + rel.familiarity * 0.7;
    rel.trust = clamp(rel.trust + delta * weight * 0.35);
    if (delta > 0) rel.affinity = clamp(rel.affinity + delta * weight * 0.1, -1, 1);
  }
}

/** Everyone the agent knows, strongest tie first. */
export function socialCircle(world: World, agent: Agent, limit = 12): Array<{ agent: Agent; rel: Relationship }> {
  return Object.values(agent.relationships)
    .map((rel) => ({ agent: world.agents[rel.with], rel }))
    .filter((entry): entry is { agent: Agent; rel: Relationship } => entry.agent != null && entry.agent.alive)
    .sort((a, b) => strength(b.rel) - strength(a.rel))
    .slice(0, limit);
}

export function strength(rel: Relationship): number {
  return rel.familiarity * 0.5 + Math.abs(rel.affinity) * 0.3 + rel.trust * 0.2;
}

/**
 * Who an agent could plausibly bump into right now: people in the same city,
 * weighted toward existing ties and toward extraverts.
 */
export function plausibleEncounters(world: World, agent: Agent, rng: Rng, n = 1): Agent[] {
  const candidates = Object.values(world.agents).filter(
    (other) => other.id !== agent.id && other.alive && other.cityId === agent.cityId && !other.travellingTo,
  );
  if (candidates.length === 0) return [];

  const weights = candidates.map((other) => {
    const rel = agent.relationships[other.id];
    const tie = rel ? 1 + strength(rel) * 6 : 0.35;
    const sameEmployer = agent.employerId && agent.employerId === other.employerId ? 3 : 1;
    const sharedInterests = other.interests.filter((i) => agent.interests.includes(i)).length;
    const sociability = 0.5 + (agent.personality.extraversion + other.personality.extraversion) / 2;
    return [other, tie * sameEmployer * (1 + sharedInterests * 0.4) * sociability] as const;
  });

  const picked: Agent[] = [];
  for (let i = 0; i < n && weights.length > 0; i++) {
    const choice = rng.weighted(weights);
    if (!picked.includes(choice)) picked.push(choice);
  }
  return picked;
}

/** Pre-wire a starting social graph so a new world isn't a room of strangers. */
export function seedRelationships(world: World, rng: Rng, averageDegree = 4): void {
  const agents = Object.values(world.agents);
  const byCity = new Map<string, Agent[]>();
  for (const agent of agents) {
    const list = byCity.get(agent.cityId) ?? [];
    list.push(agent);
    byCity.set(agent.cityId, list);
  }

  for (const [, residents] of byCity) {
    for (const agent of residents) {
      const degree = Math.max(1, Math.round(rng.gaussian(averageDegree, 1.5)));
      for (const other of rng.sample(residents.filter((r) => r.id !== agent.id), degree)) {
        const relA = ensureRelationship(agent, other, world.t);
        const relB = ensureRelationship(other, agent, world.t);
        const closeness = rng.float(0.15, 0.75);
        const warmth = rng.clampedGaussian(0.35, 0.3, -0.6, 1);

        for (const rel of [relA, relB]) {
          rel.familiarity = closeness;
          rel.affinity = warmth;
          rel.trust = clamp(0.15 + closeness * 0.5);
          rel.lastContactAt = world.t - rng.int(0, 30) * DAY;
          rel.interactions = rng.int(1, 40);
          rel.kind =
            agent.employerId && agent.employerId === other.employerId
              ? 'colleague'
              : closeness > 0.55
                ? 'friend'
                : 'acquaintance';
        }
      }
    }
  }
}

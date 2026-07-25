/**
 * The world timeline.
 *
 * Every meaningful thing that happens is appended here, forever, in order —
 * the world's git history. The UI reads it backwards to draw an agent's life,
 * and bystanders read it forwards to notice things happening around them.
 */

import type { EventCategory, World, WorldEvent, AgentId } from './types.ts';
import { nextId } from './ids.ts';

export type EventListener = (event: WorldEvent) => void;

export interface EmitInput {
  category: EventCategory;
  title: string;
  detail: string;
  agentIds?: AgentId[];
  orgIds?: string[];
  cityId?: string;
  /** 0..1. Anything below ~0.25 stays out of the main feed. */
  importance?: number;
  meta?: Record<string, unknown>;
}

const listeners = new Set<EventListener>();

/** Subscribe to every event as it is emitted. Returns an unsubscribe fn. */
export function onEvent(listener: EventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Record an event on the world timeline and notify subscribers. */
export function emit(world: World, input: EmitInput): WorldEvent {
  const event: WorldEvent = {
    id: nextId('evt'),
    t: world.t,
    category: input.category,
    title: input.title,
    detail: input.detail,
    agentIds: input.agentIds ?? [],
    orgIds: input.orgIds,
    cityId: input.cityId,
    importance: clamp01(input.importance ?? 0.4),
    meta: input.meta,
  };

  world.timeline.push(event);
  world.stats.events++;

  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A misbehaving subscriber must never stall the simulation.
    }
  }
  return event;
}

/** The most recent `limit` events, newest first. */
export function recentEvents(world: World, limit = 50, minImportance = 0): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let i = world.timeline.length - 1; i >= 0 && out.length < limit; i--) {
    const event = world.timeline[i]!;
    if (event.importance >= minImportance) out.push(event);
  }
  return out;
}

/** Everything that ever involved a given agent, oldest first. */
export function agentTimeline(world: World, agentId: AgentId, limit = 200): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let i = world.timeline.length - 1; i >= 0 && out.length < limit; i--) {
    const event = world.timeline[i]!;
    if (event.agentIds.includes(agentId)) out.push(event);
  }
  return out.reverse();
}

/** Events an agent could plausibly have noticed since a given time. */
export function ambientEvents(world: World, agentId: AgentId, since: number, limit = 12): WorldEvent[] {
  const agent = world.agents[agentId];
  if (!agent) return [];
  const out: WorldEvent[] = [];
  for (let i = world.timeline.length - 1; i >= 0; i--) {
    const event = world.timeline[i]!;
    if (event.t < since) break;
    if (out.length >= limit) break;
    if (event.agentIds.includes(agentId)) continue; // they were there; not ambient
    const sameCity = event.cityId != null && event.cityId === agent.cityId;
    const knowsSomeone = event.agentIds.some((id) => agent.relationships[id]);
    const bigNews = event.category === 'world' && event.importance >= 0.6;
    if (sameCity || knowsSomeone || bigNews) out.push(event);
  }
  return out.reverse();
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

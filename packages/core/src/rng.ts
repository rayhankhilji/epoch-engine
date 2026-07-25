/**
 * Deterministic pseudo-randomness.
 *
 * A world's entire non-LLM behaviour is reproducible from its seed: the PRNG
 * state lives on the `World` object, so snapshotting a world and resuming it
 * later continues the exact same stochastic sequence.
 */

/** mulberry32 — small, fast, and good enough for simulation. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Serialise the generator's position so a world can be resumed. */
  get state(): number {
    return this.s;
  }

  static fromState(state: number): Rng {
    return new Rng(state);
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  bool(pTrue = 0.5): boolean {
    return this.next() < pTrue;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[this.int(0, items.length - 1)]!;
  }

  /** Pick `n` distinct items (or as many as exist). */
  sample<T>(items: readonly T[], n: number): T[] {
    return this.shuffle(items).slice(0, Math.min(n, items.length));
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** Weighted choice. Weights need not sum to 1. */
  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T {
    const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0);
    if (total <= 0) return entries[0]![0];
    let r = this.next() * total;
    for (const [value, weight] of entries) {
      r -= Math.max(0, weight);
      if (r <= 0) return value;
    }
    return entries[entries.length - 1]![0];
  }

  /** Box–Muller normal deviate. */
  gaussian(mean = 0, stdDev = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** A normal deviate clamped to [min, max] — the workhorse for attributes. */
  clampedGaussian(mean: number, stdDev: number, min = 0, max = 1): number {
    return clamp(this.gaussian(mean, stdDev), min, max);
  }
}

export function clamp(value: number, min = 0, max = 1): number {
  return value < min ? min : value > max ? max : value;
}

/** Nudge a 0..1 value toward a target, used constantly for agent state drift. */
export function drift(current: number, target: number, rate: number): number {
  return clamp(current + (target - current) * clamp(rate, 0, 1));
}

/** Deterministic 32-bit hash — used to seed per-agent generators from a name. */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

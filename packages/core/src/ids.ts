/**
 * Identifiers.
 *
 * Ids are drawn from a monotonic counter rather than a random source so that a
 * world replayed from the same seed produces byte-identical ids. `seedIds` is
 * called when resuming a persisted world so new ids never collide with old ones.
 */

const counters = new Map<string, number>();

export function nextId(prefix: string): string {
  const n = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, n);
  return `${prefix}_${n.toString(36)}`;
}

/** Advance a prefix's counter past `n` when rehydrating a saved world. */
export function seedIds(prefix: string, n: number): void {
  counters.set(prefix, Math.max(counters.get(prefix) ?? 0, n));
}

/** Deterministic slug id, e.g. slugId('city', 'São Paulo') → 'city:sao-paulo'. */
export function slugId(prefix: string, label: string): string {
  const slug = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${prefix}:${slug}`;
}

/** Reset all counters — used by tests to keep ids stable across runs. */
export function resetIds(): void {
  counters.clear();
}

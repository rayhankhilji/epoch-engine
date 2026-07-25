/**
 * Simulated time.
 *
 * Epoch runs on three nested cadences, and the whole cost model of the engine
 * follows from them:
 *
 *   every sim-minute  → appraise   (free, local — decides whether to think)
 *   every sim-hour    → act        (one LLM call per awake agent)
 *   every sim-day     → reflect    (one LLM call per agent, plus world update)
 *
 * The minute pass is what makes "every minute they think" affordable: it runs a
 * salience check over the agent's state and surroundings, and only escalates to
 * the language model when something has actually changed enough to matter.
 */

import type { SimTime, World } from './types.ts';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
export const YEAR = 365 * DAY;

export interface Boundaries {
  hour: boolean;
  day: boolean;
  week: boolean;
  month: boolean;
  year: boolean;
}

/** Which cadence boundaries the world crossed moving from `prev` to `next`. */
export function boundariesCrossed(startISO: string, prev: SimTime, next: SimTime): Boundaries {
  const a = toDate(startISO, prev);
  const b = toDate(startISO, next);
  return {
    hour: Math.floor(prev / HOUR) !== Math.floor(next / HOUR),
    day: Math.floor(prev / DAY) !== Math.floor(next / DAY),
    week: Math.floor(prev / WEEK) !== Math.floor(next / WEEK),
    month: a.getUTCMonth() !== b.getUTCMonth() || a.getUTCFullYear() !== b.getUTCFullYear(),
    year: a.getUTCFullYear() !== b.getUTCFullYear(),
  };
}

/** Absolute wall-clock date for a point in sim time. */
export function toDate(startISO: string, t: SimTime): Date {
  return new Date(Date.parse(startISO) + t);
}

export function toISO(startISO: string, t: SimTime): string {
  return toDate(startISO, t).toISOString();
}

/** Sim time as seen from a given IANA timezone. */
export function localParts(
  startISO: string,
  t: SimTime,
  timezone: string,
): { hour: number; minute: number; weekday: string; dateLabel: string; minutesFromMidnight: number } {
  const date = toDate(startISO, t);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'long',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour12: false,
    }).formatToParts(date);
  } catch {
    // Unknown timezone in the city dataset — fall back to UTC rather than throw.
    return {
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      weekday: WEEKDAYS[date.getUTCDay()]!,
      dateLabel: date.toISOString().slice(0, 10),
      minutesFromMidnight: date.getUTCHours() * 60 + date.getUTCMinutes(),
    };
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return {
    hour,
    minute,
    weekday: get('weekday'),
    dateLabel: `${get('day')} ${get('month')} ${get('year')}`,
    minutesFromMidnight: hour * 60 + minute,
  };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** True when local time falls inside a typical sleep window. */
export function isAsleep(world: World, timezone: string): boolean {
  const { hour } = localParts(world.config.startISO, world.t, timezone);
  return hour >= 0 && hour < 6;
}

/** Human-friendly elapsed duration, e.g. "3d 04h". */
export function formatDuration(ms: number): string {
  if (ms < MINUTE) return `${Math.round(ms / 1000)}s`;
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ${Math.round((ms % HOUR) / MINUTE)}m`;
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  return `${days}d ${String(hours).padStart(2, '0')}h`;
}

/** "18 Mar 2027 · 14:30" for a city's local clock. */
export function stamp(world: World, timezone = 'UTC'): string {
  const p = localParts(world.config.startISO, world.t, timezone);
  return `${p.dateLabel} · ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

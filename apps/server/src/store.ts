/**
 * Persistence.
 *
 * Uses `node:sqlite`, built into Node — no native module to compile, no
 * database to install, no dependency to audit. A world is stored as its full
 * serialised state plus an append-only event log, so you can close the process
 * mid-run and pick the same society up tomorrow with its memories intact.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { World, WorldEvent } from '@epoch/core';

export interface WorldRecord {
  id: string;
  name: string;
  scenarioId: string;
  seed: number;
  createdAt: number;
  updatedAt: number;
  simTime: number;
  tick: number;
  agentCount: number;
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(path = process.env.EPOCH_DB_PATH ?? './data/epoch.db') {
    const absolute = resolve(path);
    mkdirSync(dirname(absolute), { recursive: true });

    this.db = new DatabaseSync(absolute);
    // WAL keeps reads from blocking while a tick is being written.
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS worlds (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        scenario_id  TEXT NOT NULL,
        seed         INTEGER NOT NULL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        sim_time     INTEGER NOT NULL,
        tick         INTEGER NOT NULL,
        agent_count  INTEGER NOT NULL,
        state        TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        world_id    TEXT NOT NULL,
        seq         INTEGER NOT NULL,
        id          TEXT NOT NULL,
        t           INTEGER NOT NULL,
        category    TEXT NOT NULL,
        title       TEXT NOT NULL,
        detail      TEXT NOT NULL,
        agent_ids   TEXT NOT NULL,
        city_id     TEXT,
        importance  REAL NOT NULL,
        meta        TEXT,
        PRIMARY KEY (world_id, seq)
      );

      CREATE INDEX IF NOT EXISTS events_by_world_time ON events (world_id, t DESC);
      CREATE INDEX IF NOT EXISTS events_by_importance ON events (world_id, importance DESC);
    `);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Worlds
  // ───────────────────────────────────────────────────────────────────────────

  saveWorld(id: string, scenarioId: string, world: World): void {
    const now = Date.now();

    // The timeline has its own table, so keeping it in the snapshot would store
    // every event twice and make each autosave proportional to the world's
    // entire history. Only a short tail is kept, for context on resume.
    const snapshot: World = { ...world, timeline: world.timeline.slice(-200) };
    this.db
      .prepare(
        `INSERT INTO worlds (id, name, scenario_id, seed, created_at, updated_at, sim_time, tick, agent_count, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           updated_at  = excluded.updated_at,
           sim_time    = excluded.sim_time,
           tick        = excluded.tick,
           agent_count = excluded.agent_count,
           state       = excluded.state`,
      )
      .run(
        id,
        world.config.name,
        scenarioId,
        world.config.seed,
        now,
        now,
        world.t,
        world.tick,
        Object.keys(world.agents).length,
        JSON.stringify(snapshot),
      );
  }

  loadWorld(id: string): World | null {
    const row = this.db.prepare('SELECT state FROM worlds WHERE id = ?').get(id) as
      | { state: string }
      | undefined;
    return row ? (JSON.parse(row.state) as World) : null;
  }

  listWorlds(): WorldRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, scenario_id, seed, created_at, updated_at, sim_time, tick, agent_count
         FROM worlds ORDER BY updated_at DESC`,
      )
      .all() as Array<Record<string, string | number>>;

    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      scenarioId: String(row.scenario_id),
      seed: Number(row.seed),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      simTime: Number(row.sim_time),
      tick: Number(row.tick),
      agentCount: Number(row.agent_count),
    }));
  }

  deleteWorld(id: string): void {
    this.db.prepare('DELETE FROM events WHERE world_id = ?').run(id);
    this.db.prepare('DELETE FROM worlds WHERE id = ?').run(id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Events
  // ───────────────────────────────────────────────────────────────────────────

  /** Append events. `seq` is the index in the world's own timeline. */
  appendEvents(worldId: string, events: WorldEvent[], startSeq: number): void {
    if (events.length === 0) return;

    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO events
         (world_id, seq, id, t, category, title, detail, agent_ids, city_id, importance, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.db.exec('BEGIN');
    try {
      events.forEach((event, index) => {
        insert.run(
          worldId,
          startSeq + index,
          event.id,
          event.t,
          event.category,
          event.title,
          event.detail,
          JSON.stringify(event.agentIds),
          event.cityId ?? null,
          event.importance,
          event.meta ? JSON.stringify(event.meta) : null,
        );
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  countEvents(worldId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM events WHERE world_id = ?').get(worldId) as
      | { n: number }
      | undefined;
    return Number(row?.n ?? 0);
  }

  /** Newest first. `agentId` filters to one person's life; `minImportance` to the headlines. */
  queryEvents(
    worldId: string,
    options: { limit?: number; minImportance?: number; agentId?: string; category?: string } = {},
  ): WorldEvent[] {
    const limit = Math.min(options.limit ?? 100, 1000);
    const clauses = ['world_id = ?'];
    const params: Array<string | number> = [worldId];

    if (options.minImportance != null) {
      clauses.push('importance >= ?');
      params.push(options.minImportance);
    }
    if (options.category) {
      clauses.push('category = ?');
      params.push(options.category);
    }
    if (options.agentId) {
      // agent_ids is a JSON array; a substring match is exact enough given ids
      // are unique tokens and is far faster than json_each here.
      clauses.push('agent_ids LIKE ?');
      params.push(`%"${options.agentId}"%`);
    }

    const rows = this.db
      .prepare(
        `SELECT id, t, category, title, detail, agent_ids, city_id, importance, meta
         FROM events WHERE ${clauses.join(' AND ')} ORDER BY t DESC, seq DESC LIMIT ?`,
      )
      .all(...params, limit) as Array<Record<string, string | number | null>>;

    return rows.map((row) => ({
      id: String(row.id),
      t: Number(row.t),
      category: String(row.category) as WorldEvent['category'],
      title: String(row.title),
      detail: String(row.detail),
      agentIds: JSON.parse(String(row.agent_ids)) as string[],
      cityId: row.city_id == null ? undefined : String(row.city_id),
      importance: Number(row.importance),
      meta: row.meta == null ? undefined : (JSON.parse(String(row.meta)) as Record<string, unknown>),
    }));
  }

  close(): void {
    this.db.close();
  }
}

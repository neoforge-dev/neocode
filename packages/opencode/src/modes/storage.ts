import Database from "bun:sqlite"
import type { Mode, ModeContext } from "./types"

export interface ModeStorage {
  getModeContext(sessionId: string): Promise<ModeContext | null>
  setModeContext(context: ModeContext): Promise<void>
  getTransitionHistory(
    sessionId: string,
    limit?: number,
  ): Promise<ModeTransition[]>
  logTransition(
    transition: ModeTransition & { sessionId: string },
  ): Promise<void>
  close(): Promise<void>
}

interface ModeTransition {
  from: Mode
  to: Mode
  reason: string
  triggeredBy: "user" | "auto" | "suggestion"
  timestamp: Date
}

export class SQLiteModeStorage implements ModeStorage {
  private db: Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
  }

  async initialize(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mode_state (
        session_id TEXT PRIMARY KEY,
        current_mode TEXT NOT NULL,
        metadata TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS mode_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        from_mode TEXT NOT NULL,
        to_mode TEXT NOT NULL,
        reason TEXT,
        triggered_by TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_mode_transitions_session ON mode_transitions(session_id);
      CREATE INDEX IF NOT EXISTS idx_mode_transitions_timestamp ON mode_transitions(timestamp);
    `)
  }

  async getModeContext(sessionId: string): Promise<ModeContext | null> {
    const row = this.db
      .prepare(
        `
        SELECT current_mode, metadata, updated_at
        FROM mode_state 
        WHERE session_id = ?
      `,
      )
      .get(sessionId) as any

    if (!row) {
      return null
    }

    return {
      mode: row.current_mode as Mode,
      sessionId,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      timestamp: new Date(row.updated_at),
    }
  }

  async setModeContext(context: ModeContext): Promise<void> {
    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO mode_state (session_id, current_mode, metadata, updated_at)
        VALUES (?, ?, ?, ?)
      `,
      )
      .run(
        context.sessionId,
        context.mode,
        JSON.stringify(context.metadata),
        context.timestamp.toISOString(),
      )
  }

  async getTransitionHistory(
    sessionId: string,
    limit = 50,
  ): Promise<ModeTransition[]> {
    const rows = this.db
      .prepare(
        `
        SELECT from_mode, to_mode, reason, triggered_by, timestamp
        FROM mode_transitions 
        WHERE session_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `,
      )
      .all(sessionId, limit) as any[]

    return rows.map((row) => ({
      from: row.from_mode as Mode,
      to: row.to_mode as Mode,
      reason: row.reason,
      triggeredBy: row.triggered_by as "user" | "auto" | "suggestion",
      timestamp: new Date(row.timestamp),
    }))
  }

  async logTransition(
    transition: ModeTransition & { sessionId: string },
  ): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO mode_transitions (session_id, from_mode, to_mode, reason, triggered_by, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        transition.sessionId,
        transition.from,
        transition.to,
        transition.reason,
        transition.triggeredBy,
        transition.timestamp.toISOString(),
      )
  }

  async close(): Promise<void> {
    this.db.close()
  }
}

// Pure board logic: column vocabulary, input normalisation, and the SQLite
// store. No bb API here so it stays unit-testable without a server.
import type { Database } from "better-sqlite3";

export const COLUMNS = [
  { id: "backlog", name: "Backlog" },
  { id: "in-progress", name: "In progress" },
  { id: "review", name: "Review" },
  { id: "done", name: "Done" },
] as const;

export type ColumnId = (typeof COLUMNS)[number]["id"];
export const COLUMN_IDS = COLUMNS.map((column) => column.id) as ColumnId[];

export type MovedBy = "agent" | "user" | "system";

export interface Card {
  threadId: string;
  projectId: string;
  columnId: ColumnId;
  position: number;
  note: string;
  movedBy: MovedBy;
  createdAt: number;
  updatedAt: number;
}

export interface Move {
  id: number;
  threadId: string;
  fromColumn: ColumnId | null;
  toColumn: ColumnId;
  movedBy: MovedBy;
  note: string;
  at: number;
}

/** Freeform spellings agents and people reach for, mapped to a column id. */
const ALIASES: Record<string, ColumnId> = {
  backlog: "backlog",
  todo: "backlog",
  "to-do": "backlog",
  queued: "backlog",
  new: "backlog",
  "in-progress": "in-progress",
  inprogress: "in-progress",
  progress: "in-progress",
  doing: "in-progress",
  wip: "in-progress",
  active: "in-progress",
  working: "in-progress",
  started: "in-progress",
  review: "review",
  "in-review": "review",
  reviewing: "review",
  qa: "review",
  testing: "review",
  ready: "review",
  done: "done",
  complete: "done",
  completed: "done",
  finished: "done",
  shipped: "done",
  closed: "done",
};

export function normaliseColumn(input: string): ColumnId | null {
  const key = input.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (key === "") return null;
  return ALIASES[key] ?? null;
}

export function columnName(id: ColumnId): string {
  return COLUMNS.find((column) => column.id === id)?.name ?? id;
}

export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS cards (
    thread_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    column_id TEXT NOT NULL,
    position REAL NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    moved_by TEXT NOT NULL DEFAULT 'system',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS cards_column_position ON cards (column_id, position)`,
  `CREATE TABLE IF NOT EXISTS moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL,
    from_column TEXT,
    to_column TEXT NOT NULL,
    moved_by TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS moves_thread ON moves (thread_id, id)`,
];

interface CardRow {
  thread_id: string;
  project_id: string;
  column_id: string;
  position: number;
  note: string;
  moved_by: string;
  created_at: number;
  updated_at: number;
}

interface MoveRow {
  id: number;
  thread_id: string;
  from_column: string | null;
  to_column: string;
  moved_by: string;
  note: string;
  at: number;
}

function toCard(row: CardRow): Card {
  return {
    threadId: row.thread_id,
    projectId: row.project_id,
    columnId: (normaliseColumn(row.column_id) ?? "backlog") as ColumnId,
    position: row.position,
    note: row.note,
    movedBy: toMovedBy(row.moved_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMovedBy(value: string): MovedBy {
  return value === "agent" || value === "user" ? value : "system";
}

function toMove(row: MoveRow): Move {
  return {
    id: row.id,
    threadId: row.thread_id,
    fromColumn: row.from_column === null ? null : normaliseColumn(row.from_column),
    toColumn: normaliseColumn(row.to_column) ?? "backlog",
    movedBy: toMovedBy(row.moved_by),
    note: row.note,
    at: row.at,
  };
}

export interface PlaceOptions {
  /** Insert before this card in the target column (same column allowed). */
  beforeThreadId?: string | null;
  /** Insert after this card in the target column. Ignored when before is set. */
  afterThreadId?: string | null;
}

export class BoardStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = () => Date.now(),
  ) {}

  list(projectId?: string | null): Card[] {
    const rows =
      projectId === undefined || projectId === null
        ? this.db
            .prepare(`SELECT * FROM cards ORDER BY column_id, position, created_at`)
            .all()
        : this.db
            .prepare(
              `SELECT * FROM cards WHERE project_id = ? ORDER BY column_id, position, created_at`,
            )
            .all(projectId);
    return (rows as CardRow[]).map(toCard);
  }

  get(threadId: string): Card | null {
    const row = this.db
      .prepare(`SELECT * FROM cards WHERE thread_id = ?`)
      .get(threadId) as CardRow | undefined;
    return row === undefined ? null : toCard(row);
  }

  /** Add a thread to the board. Returns the existing card when already present. */
  add(
    threadId: string,
    projectId: string,
    columnId: ColumnId = "backlog",
    movedBy: MovedBy = "system",
    note = "",
  ): { card: Card; created: boolean } {
    const existing = this.get(threadId);
    if (existing !== null) return { card: existing, created: false };
    const at = this.now();
    const position = this.nextPosition(columnId);
    this.db
      .prepare(
        `INSERT INTO cards (thread_id, project_id, column_id, position, note, moved_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(threadId, projectId, columnId, position, note, movedBy, at, at);
    this.recordMove(threadId, null, columnId, movedBy, note, at);
    return { card: this.get(threadId) as Card, created: true };
  }

  /**
   * Move a card to a column (and optionally a slot). A move within the same
   * column without a slot is a no-op. A note, when given, replaces the card's note.
   */
  move(
    threadId: string,
    columnId: ColumnId,
    movedBy: MovedBy,
    options: PlaceOptions & { note?: string } = {},
  ): { card: Card; changed: boolean } | null {
    const current = this.get(threadId);
    if (current === null) return null;
    const at = this.now();
    const columnChanged = current.columnId !== columnId;
    const hasSlot =
      typeof options.beforeThreadId === "string" ||
      typeof options.afterThreadId === "string";
    const noteChanged = options.note !== undefined && options.note !== current.note;
    if (!columnChanged && !hasSlot && !noteChanged) {
      return { card: current, changed: false };
    }
    const position = hasSlot
      ? this.slotPosition(columnId, threadId, options)
      : columnChanged
        ? this.nextPosition(columnId)
        : current.position;
    const note = options.note ?? current.note;
    this.db
      .prepare(
        `UPDATE cards SET column_id = ?, position = ?, note = ?, moved_by = ?, updated_at = ? WHERE thread_id = ?`,
      )
      .run(columnId, position, note, movedBy, at, threadId);
    if (columnChanged) {
      this.recordMove(threadId, current.columnId, columnId, movedBy, note, at);
    }
    return { card: this.get(threadId) as Card, changed: true };
  }

  remove(threadId: string): boolean {
    const result = this.db.prepare(`DELETE FROM cards WHERE thread_id = ?`).run(threadId);
    this.db.prepare(`DELETE FROM moves WHERE thread_id = ?`).run(threadId);
    return result.changes > 0;
  }

  history(threadId: string, limit = 50): Move[] {
    const rows = this.db
      .prepare(`SELECT * FROM moves WHERE thread_id = ? ORDER BY id DESC LIMIT ?`)
      .all(threadId, limit) as MoveRow[];
    return rows.map(toMove);
  }

  private nextPosition(columnId: ColumnId): number {
    const row = this.db
      .prepare(`SELECT MAX(position) AS max FROM cards WHERE column_id = ?`)
      .get(columnId) as { max: number | null };
    return (row.max ?? 0) + 1;
  }

  private slotPosition(
    columnId: ColumnId,
    movingThreadId: string,
    options: PlaceOptions,
  ): number {
    const siblings = (
      this.db
        .prepare(
          `SELECT * FROM cards WHERE column_id = ? AND thread_id != ? ORDER BY position, created_at`,
        )
        .all(columnId, movingThreadId) as CardRow[]
    ).map(toCard);
    const anchorId = options.beforeThreadId ?? options.afterThreadId ?? null;
    const index = siblings.findIndex((card) => card.threadId === anchorId);
    if (anchorId === null || index === -1) return this.nextPosition(columnId);
    const before = typeof options.beforeThreadId === "string";
    const prev = before ? siblings[index - 1] : siblings[index];
    const next = before ? siblings[index] : siblings[index + 1];
    if (prev === undefined && next === undefined) return 1;
    if (prev === undefined) return (next as Card).position - 1;
    if (next === undefined) return prev.position + 1;
    return (prev.position + next.position) / 2;
  }

  private recordMove(
    threadId: string,
    from: ColumnId | null,
    to: ColumnId,
    movedBy: MovedBy,
    note: string,
    at: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO moves (thread_id, from_column, to_column, moved_by, note, at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(threadId, from, to, movedBy, note, at);
  }
}

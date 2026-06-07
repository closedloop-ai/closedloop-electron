import { DatabaseSync } from "node:sqlite";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import path from "node:path";
import { PGlite, type Results } from "@electric-sql/pglite";

const BACKUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PGLITE_DIRECTORY_SUFFIX = ".pgdata";
const BATCH_SIZE = 500;

const TABLES = [
  {
    name: "sessions",
    conflictTarget: "id",
    columns: [
      "id",
      "name",
      "status",
      "cwd",
      "model",
      "started_at",
      "updated_at",
      "ended_at",
      "awaiting_input_since",
      "metadata",
      "harness",
      "billing_mode",
      "user_id",
      "organization_id",
    ],
  },
  {
    name: "agents",
    conflictTarget: "id",
    columns: [
      "id",
      "session_id",
      "name",
      "type",
      "subagent_type",
      "status",
      "task",
      "current_tool",
      "started_at",
      "updated_at",
      "ended_at",
      "awaiting_input_since",
      "parent_agent_id",
      "metadata",
      "user_id",
      "organization_id",
    ],
  },
  {
    name: "events",
    conflictTarget: "id",
    columns: [
      "id",
      "session_id",
      "agent_id",
      "event_type",
      "tool_name",
      "summary",
      "data",
      "created_at",
      "user_id",
      "organization_id",
    ],
  },
  {
    name: "token_usage",
    conflictTarget: "session_id, model",
    columns: [
      "session_id",
      "model",
      "input_tokens",
      "output_tokens",
      "cache_read_tokens",
      "cache_write_tokens",
      "raw_input",
      "raw_output",
      "raw_cache_read",
      "raw_cache_write",
      "created_at",
      "updated_at",
      "user_id",
      "organization_id",
    ],
  },
] as const;

type TableName = (typeof TABLES)[number]["name"];
type TableCounts = Record<TableName, number>;

export type SqliteToPgliteMigrationResult =
  | {
      status: "skipped";
      reason: "sqlite_missing" | "already_migrated";
      sqlitePath: string;
      pgliteDataDir: string;
    }
  | {
      status: "migrated";
      sqlitePath: string;
      sqliteBackupPath: string | null;
      pgliteDataDir: string;
      rowCounts: TableCounts;
    }
  | {
      status: "failed";
      sqlitePath: string;
      pgliteDataDir: string;
      error: string;
      failedAt: string;
    };

export interface SqliteToPgliteMigrationOptions {
  sqlitePath: string;
  pgliteDataDir?: string;
  now?: () => Date;
  log?: (message: string) => void;
  /**
   * When true, skip the final rename of the SQLite source to .bak.
   * Used during startup migration so the existing SQLite runtime can
   * continue serving reads and writes until the stores are migrated
   * to PGlite.
   */
  keepSource?: boolean;
}

interface PgliteExecutor {
  exec(query: string): Promise<Results[]>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    params?: unknown[],
  ): Promise<Results<T>>;
}

interface PgliteClient extends PgliteExecutor {
  transaction<T>(callback: (tx: PgliteExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function resolvePgliteDataDir(sqlitePath: string): string {
  const parsed = path.parse(sqlitePath);
  return path.join(parsed.dir, `${parsed.name}${PGLITE_DIRECTORY_SUFFIX}`);
}

const BACKUP_NAME_REGEX = /^(.+\.bak)(\.\d+)?$/;

export async function cleanupExpiredSqliteBackups(
  sqlitePath: string,
  now = new Date(),
  retentionMs = BACKUP_RETENTION_MS,
): Promise<number> {
  const dir = path.dirname(sqlitePath);
  const basename = path.basename(sqlitePath);
  let removed = 0;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }

  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry === `${basename}.bak` ||
          BACKUP_NAME_REGEX.test(entry) && entry.startsWith(`${basename}.bak`),
      )
      .map(async (entry) => {
        const backupPath = path.join(dir, entry);
        const info = await stat(backupPath).catch(() => null);
        if (!info?.isFile()) {
          return;
        }
        if (now.getTime() - info.mtime.getTime() < retentionMs) {
          return;
        }
        await rm(backupPath, { force: true });
        removed += 1;
      }),
  );

  return removed;
}

export async function migrateSqliteToPglite(
  options: SqliteToPgliteMigrationOptions,
): Promise<SqliteToPgliteMigrationResult> {
  const sqlitePath = options.sqlitePath;
  const pgliteDataDir = options.pgliteDataDir ?? resolvePgliteDataDir(sqlitePath);
  const log = options.log ?? (() => {});
  const stampTime = options.now?.() ?? new Date();

  await cleanupExpiredSqliteBackups(sqlitePath, stampTime);

  const backupExists = await fileExists(`${sqlitePath}.bak`);
  const pgdataExists = await fileExists(pgliteDataDir);

  if (!(await fileExists(sqlitePath))) {
    return {
      status: "skipped",
      reason: backupExists && pgdataExists
        ? "already_migrated"
        : "sqlite_missing",
      sqlitePath,
      pgliteDataDir,
    };
  }

  if (backupExists && pgdataExists) {
    await rm(sqlitePath, { force: true });
    return {
      status: "skipped",
      reason: "already_migrated",
      sqlitePath,
      pgliteDataDir,
    };
  }

  const backupPath = `${sqlitePath}.bak`;

  let sqlite: DatabaseSync | null = null;
  let pglite: PgliteClient | null = null;
  try {
    const stagingDir = await mkdtemp(
      path.join(path.dirname(pgliteDataDir), ".pglite-staging-"),
    );
    try {
      sqlite = new DatabaseSync(sqlitePath);
      assertAllTablesManaged(sqlite);
      pglite = await PGlite.create(stagingDir);

      const sourceSchema = readSqliteSchema(sqlite);
      const sourceCounts = readSourceCounts(sqlite, sourceSchema);
      await initializeAndCopy(sqlite, pglite, sourceSchema, sourceCounts);

      sqlite.close();
      sqlite = null;
      await pglite.close();
      pglite = null;

      let sqliteBackupPath: string | null = null;
      if (options.keepSource) {
        log(
          `SQLite to PGlite migration succeeded: db=${sanitizePath(sqlitePath)}, source preserved for runtime`,
        );
      } else {
        await rotateExistingBackup(backupPath);
        await rename(sqlitePath, backupPath);
        await utimes(backupPath, stampTime, stampTime);
        sqliteBackupPath = backupPath;
        log(
          `SQLite to PGlite migration succeeded: db=${sanitizePath(sqlitePath)}, backup stamped at ${stampTime.toISOString()}`,
        );
      }

      await rm(pgliteDataDir, { recursive: true, force: true }).catch(
        () => {},
      );
      await rename(stagingDir, pgliteDataDir);

      return {
        status: "migrated",
        sqlitePath,
        sqliteBackupPath,
        pgliteDataDir,
        rowCounts: sourceCounts,
      };
    } finally {
      await rm(stagingDir, { recursive: true, force: true }).catch(
        () => {},
      );
    }
  } catch (error) {
    log(
      `SQLite to PGlite migration failed: sqlite=${sqlitePath}, pglite=${sanitizePath(pgliteDataDir)}, error=${sanitizeError(error)}`,
    );
    return {
      status: "failed",
      sqlitePath,
      pgliteDataDir,
      error: sanitizeError(error),
      failedAt: new Date().toISOString(),
    };
  } finally {
    try {
      sqlite?.close();
    } catch {
      /* ignore close failure */
    }
    try {
      await pglite?.close();
    } catch {
      /* ignore close failure */
    }
  }
}

async function rotateExistingBackup(backupPath: string): Promise<void> {
  if (!(await fileExists(backupPath))) {
    return;
  }
  const rotatedPath = `${backupPath}.${Date.now()}`;
  await rename(backupPath, rotatedPath);
}

async function initializeAndCopy(
  sqlite: DatabaseSync,
  pglite: PgliteClient,
  sourceSchema: Map<string, Set<string>>,
  sourceCounts: TableCounts,
): Promise<void> {
  await pglite.transaction(async (tx) => {
    await tx.exec(PGLITE_SCHEMA);
    await tx.exec(`
      TRUNCATE TABLE
        events,
        agents,
        token_usage,
        sessions,
        agent_database_metadata
      RESTART IDENTITY CASCADE;
    `);

    for (const table of TABLES) {
      const sourceColumns = sourceSchema.get(table.name);
      if (!sourceColumns) {
        continue;
      }
      const columns = table.columns.filter((column) => sourceColumns.has(column));
      if (columns.length === 0) {
        continue;
      }
      const rows = sqlite
        .prepare(`SELECT ${columns.join(", ")} FROM ${table.name}`)
        .all() as Record<string, unknown>[];

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        await batchInsertRows(
          tx,
          table.name,
          table.conflictTarget,
          columns,
          batch,
        );
      }
    }

    const destinationCounts = await readDestinationCounts(tx);
    for (const table of TABLES) {
      if (sourceCounts[table.name] !== destinationCounts[table.name]) {
        throw new Error(
          `row count mismatch for ${table.name}: sqlite=${sourceCounts[table.name]} pglite=${destinationCounts[table.name]}`,
        );
      }
    }

    await tx.query(
      `
        INSERT INTO agent_database_metadata (key, value)
        VALUES ($1, $2)
      `,
      [
        "sqlite_to_pglite_migrated_at",
        JSON.stringify({
          migratedAt: new Date().toISOString(),
          rowCounts: destinationCounts,
        }),
      ],
    );
  });
}

async function batchInsertRows(
  pglite: PgliteExecutor,
  tableName: string,
  conflictTarget: string,
  columns: readonly string[],
  rows: Record<string, unknown>[],
): Promise<void> {
  const params: unknown[] = [];
  const valueRows: string[] = [];

  for (const row of rows) {
    const rowParams = columns.map((col) => {
      params.push(row[col] ?? null);
      return `$${params.length}`;
    });
    valueRows.push(`(${rowParams.join(", ")})`);
  }

  await pglite.query(
    `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES ${valueRows.join(", ")} ON CONFLICT (${conflictTarget}) DO NOTHING`,
    params,
  );
}

function readSqliteSchema(sqlite: DatabaseSync): Map<string, Set<string>> {
  const schema = new Map<string, Set<string>>();
  for (const table of TABLES) {
    const rows = sqlite.prepare(`PRAGMA table_info(${table.name})`).all() as Array<{
      name: string;
    }>;
    if (rows.length === 0) {
      continue;
    }
    schema.set(table.name, new Set(rows.map((row) => row.name)));
  }
  return schema;
}

function readSourceCounts(
  sqlite: DatabaseSync,
  sourceSchema: Map<string, Set<string>>,
): TableCounts {
  return Object.fromEntries(
    TABLES.map((table) => [
      table.name,
      sourceSchema.has(table.name)
        ? ((sqlite.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get() as {
            count: number;
          }).count ?? 0)
        : 0,
    ]),
  ) as TableCounts;
}

async function readDestinationCounts(pglite: PgliteExecutor): Promise<TableCounts> {
  const entries: Array<[TableName, number]> = [];
  for (const table of TABLES) {
    const result = await pglite.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM ${table.name}`,
    );
    entries.push([table.name, Number(result.rows[0]?.count ?? 0)]);
  }
  return Object.fromEntries(entries) as TableCounts;
}

function assertAllTablesManaged(sqlite: DatabaseSync): void {
  const tableNames = new Set<string>(TABLES.map((t) => t.name));
  const rows = sqlite.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
  ).all() as { name: string }[];
  const unmanaged = rows.filter((row) => !tableNames.has(row.name));
  if (unmanaged.length > 0) {
    throw new Error(
      `Unmanaged table(s) found in source SQLite: ${unmanaged.map((r) => r.name).join(", ")}. Add these to TABLES before migrating.`,
    );
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sanitizePath(filePath: string): string {
  return path.basename(filePath);
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

const PGLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  cwd TEXT,
  model TEXT,
  started_at TEXT,
  updated_at TEXT,
  ended_at TEXT,
  awaiting_input_since TEXT,
  metadata TEXT,
  harness TEXT,
  billing_mode TEXT,
  user_id TEXT,
  organization_id TEXT
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT,
  type TEXT,
  subagent_type TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  task TEXT,
  current_tool TEXT,
  started_at TEXT,
  updated_at TEXT,
  ended_at TEXT,
  awaiting_input_since TEXT,
  parent_agent_id TEXT,
  metadata TEXT,
  user_id TEXT,
  organization_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_agents_session_id ON agents(session_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type);
CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_agent_id) WHERE parent_agent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  event_type TEXT NOT NULL,
  tool_name TEXT,
  summary TEXT,
  data TEXT,
  created_at TEXT,
  user_id TEXT,
  organization_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_agent_id ON events(agent_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_tool_name ON events(tool_name) WHERE tool_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_session_tool ON events(session_id, created_at) WHERE tool_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_tool_created ON events(created_at, tool_name) WHERE tool_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS token_usage (
  session_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  raw_input INTEGER NOT NULL DEFAULT 0,
  raw_output INTEGER NOT NULL DEFAULT 0,
  raw_cache_read INTEGER NOT NULL DEFAULT 0,
  raw_cache_write INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (now()::text),
  updated_at TEXT,
  user_id TEXT,
  organization_id TEXT,
  PRIMARY KEY (session_id, model)
);

CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status_started_at ON sessions(status, started_at DESC);

CREATE TABLE IF NOT EXISTS agent_database_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

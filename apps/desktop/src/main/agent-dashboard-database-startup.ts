import { basename, join } from "node:path";
import {
  cleanupExpiredSqliteBackups,
  migrateSqliteToPglite,
  resolvePgliteDataDir,
  type SqliteToPgliteMigrationResult,
} from "./database/sqlite-to-pglite-migration.js";

export type AgentDashboardDatabaseBackend = "sqlite" | "pglite";

export type AgentDashboardDatabaseStartupResult =
  | {
      backend: "sqlite";
      sqlitePath: string;
      pgliteDataDir: string;
      migration?: SqliteToPgliteMigrationResult;
    }
  | {
      backend: "pglite";
      sqlitePath: string;
      pgliteDataDir: string;
      migration?: SqliteToPgliteMigrationResult;
      migrationPromise: Promise<SqliteToPgliteMigrationResult>;
    };

export function resolveAgentDashboardDatabasePathForUserData(
  userDataPath: string,
): string {
  return join(userDataPath, "agent-dashboard.sqlite");
}

export async function prepareAgentDashboardDatabaseStartup(options: {
  userDataPath: string;
  backend: AgentDashboardDatabaseBackend;
  log?: (scope: string, message: string) => void;
}): Promise<AgentDashboardDatabaseStartupResult> {
  const sqlitePath = resolveAgentDashboardDatabasePathForUserData(
    options.userDataPath,
  );
  const pgliteDataDir = resolvePgliteDataDir(sqlitePath);
  const log = options.log ?? (() => {});

  const removed = await cleanupExpiredSqliteBackups(sqlitePath);
  if (removed > 0) {
    log(
      "agent-dashboard-migration",
      `Removed ${removed} expired SQLite backup(s) for ${basename(sqlitePath)}`,
    );
  }

  if (options.backend === "sqlite") {
    return { backend: "sqlite", sqlitePath, pgliteDataDir };
  }

  const onSettled = (migration: SqliteToPgliteMigrationResult) => {
    if (migration.status === "failed") {
      log(
        "agent-dashboard-migration",
        `PGlite migration failed (runtime continues on SQLite): ${migration.error}`,
      );
    } else if (migration.status === "migrated") {
      log(
        "agent-dashboard-migration",
        `PGlite migration completed (${migration.rowCounts.sessions} sessions); SQLite preserved for sync runtime`,
      );
    }
    return migration;
  };

  const migrationPromise = migrateSqliteToPglite({
    sqlitePath,
    pgliteDataDir,
    keepSource: true,
    log: (message) => log("agent-dashboard-migration", message),
  }).then(onSettled, (error: unknown) => {
    const err = error instanceof Error ? error.message : String(error);
    log("agent-dashboard-migration", `PGlite migration failed: ${err}`);
    return {
      status: "failed" as const,
      sqlitePath,
      pgliteDataDir,
      error: err,
      failedAt: new Date().toISOString(),
    };
  });

  return {
    backend: "pglite",
    sqlitePath,
    pgliteDataDir,
    migrationPromise,
  };
}

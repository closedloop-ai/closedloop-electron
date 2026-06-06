import path from "node:path";
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
      migration: SqliteToPgliteMigrationResult;
    };

export function resolveAgentDashboardDatabasePathForUserData(
  userDataPath: string,
): string {
  return path.join(userDataPath, "agent-dashboard.sqlite");
}

/**
 * Startup-owned preparation for the dashboard database engine. SQLite mode only
 * performs stale backup cleanup so the current SQLite runtime cannot rename its
 * own live database. PGlite mode runs the forward migration before the PGlite
 * runtime opens; failure returns a SQLite fallback result and leaves the source
 * DB intact for retry on the next launch.
 */
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

  if (options.backend === "sqlite") {
    const removed = await cleanupExpiredSqliteBackups(sqlitePath);
    if (removed > 0) {
      log(
        "agent-dashboard-migration",
        `Removed ${removed} expired SQLite backup(s) for ${sqlitePath}`,
      );
    }
    return { backend: "sqlite", sqlitePath, pgliteDataDir };
  }

  const migration = await migrateSqliteToPglite({
    sqlitePath,
    pgliteDataDir,
    log: (message) => log("agent-dashboard-migration", message),
  });
  if (migration.status === "failed") {
    log(
      "agent-dashboard-migration",
      `Falling back to SQLite after PGlite migration failure: ${migration.error}`,
    );
    return {
      backend: "sqlite",
      sqlitePath,
      pgliteDataDir,
      migration,
    };
  }

  return {
    backend: "pglite",
    sqlitePath,
    pgliteDataDir,
    migration,
  };
}

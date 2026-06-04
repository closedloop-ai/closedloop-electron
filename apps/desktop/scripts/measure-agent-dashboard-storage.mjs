#!/usr/bin/env node
/**
 * Measure Agent Dashboard SQLite storage without creating missing DB files.
 *
 * The legacy sidecar DB lives at `<userData>/agent-monitor/dashboard.db`; the
 * Labs design-system DB lives at `<userData>/agent-dashboard.sqlite`. Missing
 * files are reported as absent and are never opened.
 */
import { existsSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const APP_NAME = "ClosedLoop";

const userDataPath = parseUserDataArg(process.argv) ?? defaultUserDataPath();
const targets = [
  {
    mode: "legacy",
    path: path.join(userDataPath, "agent-monitor", "dashboard.db"),
  },
  {
    mode: "design-system",
    path: path.join(userDataPath, "agent-dashboard.sqlite"),
  },
];

const measurements = targets.map(measureExistingDatabase);
console.log(JSON.stringify({ userDataPath, measurements }, null, 2));

function parseUserDataArg(argv) {
  const index = argv.indexOf("--user-data");
  if (index < 0) {
    return null;
  }
  const value = argv[index + 1];
  if (!value) {
    throw new Error("--user-data requires a path value");
  }
  return path.resolve(value);
}

function defaultUserDataPath() {
  switch (platform()) {
    case "darwin":
      return path.join(homedir(), "Library", "Application Support", APP_NAME);
    case "win32":
      return path.join(
        process.env.APPDATA || path.join(homedir(), "AppData", "Roaming"),
        APP_NAME,
      );
    default:
      return path.join(homedir(), ".config", APP_NAME);
  }
}

function measureExistingDatabase(target) {
  if (!existsSync(target.path)) {
    return {
      mode: target.mode,
      path: target.path,
      exists: false,
      bytes: 0,
      tables: [],
      indexes: [],
    };
  }

  const db = new DatabaseSync(target.path);
  try {
    const objects = db
      .prepare(
        `
          SELECT type, name
          FROM sqlite_master
          WHERE type IN ('table', 'index')
          ORDER BY type ASC, name ASC
        `,
      )
      .all();
    return {
      mode: target.mode,
      path: target.path,
      exists: true,
      bytes: statSync(target.path).size,
      tables: objects
        .filter((row) => row.type === "table")
        .map((row) => row.name),
      indexes: objects
        .filter((row) => row.type === "index")
        .map((row) => row.name),
    };
  } finally {
    db.close();
  }
}

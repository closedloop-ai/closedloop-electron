// Boots one fixture-loaded sidecar that every UI spec shares. The base URL is
// passed to specs via E2E_BASE_URL (read by playwright.config.ts), and the
// teardown file kills the sidecar.

import type { FullConfig } from "@playwright/test";
// @ts-expect-error — .mjs files are loaded by ts-node-less Node
import {
  makeTempDbPath,
  reseedPacksAndSkills,
  seedFixtureDb,
} from "./seed-fixture-db.mjs";
// @ts-expect-error — see above
import { launchSidecar } from "./launch-sidecar.mjs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export default async function globalSetup(_config: FullConfig) {
  const tmp = makeTempDbPath();
  seedFixtureDb(tmp.dbPath);
  const sidecar = await launchSidecar({ dbPath: tmp.dbPath });
  reseedPacksAndSkills(tmp.dbPath);

  // Hand off to teardown via env + a tiny state file. Playwright forks workers,
  // so process-level globals don't survive — the state file is the bridge.
  const statePath = join(
    process.env.RUNNER_TEMP || "/tmp",
    "closedloop-e2e-sidecar-state.json",
  );
  writeFileSync(
    statePath,
    JSON.stringify({ baseUrl: sidecar.baseUrl, pid: sidecar.pid, dbPath: tmp.dbPath }),
  );
  process.env.E2E_BASE_URL = sidecar.baseUrl;
  process.env.E2E_SIDECAR_STATE = statePath;
}

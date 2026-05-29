import { defineConfig, devices } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Resolve baseURL from the state file globalSetup writes. We can't rely on
// process.env.E2E_BASE_URL here: this config is evaluated at controller load
// time, BEFORE globalSetup runs. Workers re-evaluate the config after
// globalSetup, but if the env mutation didn't propagate cleanly the run
// silently degrades to relative-URL goto failures. The state file is the
// stable bridge — globalSetup writes it before the workers start.
function resolveBaseUrl(): string | undefined {
  const statePath = join(
    process.env.RUNNER_TEMP || "/tmp",
    "closedloop-e2e-sidecar-state.json",
  );
  if (existsSync(statePath)) {
    try {
      const { baseUrl } = JSON.parse(readFileSync(statePath, "utf8"));
      if (baseUrl) return baseUrl;
    } catch {
      /* fall through to env */
    }
  }
  return process.env.E2E_BASE_URL;
}

export default defineConfig({
  // Default e2e config covers ONLY ./specs/ui. Audit Playwright specs live
  // in ./specs/audit and are run via a dedicated config
  // (playwright.audit.config.ts) so a known-failing audit spec
  // (e.g. dashboard.ui-audit.spec.ts asserting the FEA-1418 cost bug) does
  // NOT block the default `test:e2e` command.
  testDir: "./specs",
  testMatch: /ui\/.*\.spec\.ts$/,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  globalSetup: "./helpers/playwright-global-setup.ts",
  globalTeardown: "./helpers/playwright-global-teardown.ts",
  use: {
    baseURL: resolveBaseUrl(),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});

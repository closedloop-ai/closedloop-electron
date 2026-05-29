// Dedicated Playwright config for the manifest-driven UI-audit specs in
// ./specs/audit. Kept separate from playwright.config.ts so that running
// the default `test:e2e` command does NOT pick up audit specs that
// intentionally assert current (buggy) behavior — those specs are gated
// behind `test:audit:ui`.
//
// Everything else (workers, reporters, baseURL resolution, setup/teardown)
// inherits from the e2e config so the two stay in sync.

import baseConfig from "./playwright.config.js";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  ...baseConfig,
  testMatch: /audit\/.*\.spec\.ts$/,
});

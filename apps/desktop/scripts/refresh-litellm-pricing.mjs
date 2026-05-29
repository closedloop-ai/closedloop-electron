// Refresh the vendored LiteLLM pricing JSON in-place, then validate the
// merged ruleset against build-time invariants before allowing the changes
// to stand. Run via `pnpm refresh:pricing` or `just desktop-refresh-pricing`.
//
// Workflow:
//   1. Fetch upstream JSON and write litellm-pricing.json + meta in-place.
//   2. Import loadHostDefaultPricing() from build-agent-monitor.mjs and call
//      it. The loader throws if any invariant (e.g. Opus 4.x floor) fails.
//   3. On failure, leave the new JSON on disk so a human can inspect the
//      diff, but exit non-zero and print the offending row so CI / `just`
//      shows a red status.
//
// Targets Node ≥ 22, no extra deps.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { runFetchAndWrite } from "./fetch-litellm-pricing.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  process.stdout.write(
    `[refresh-litellm-pricing] Fetching upstream and writing ${scriptDir}…\n`,
  );
  const { jsonPath, sha, rowCount } = await runFetchAndWrite({
    outDir: scriptDir,
  });
  process.stdout.write(
    `[refresh-litellm-pricing] Wrote ${rowCount} rows to ${jsonPath} (sha256 ${sha.slice(0, 12)}…)\n`,
  );

  process.stdout.write(
    "[refresh-litellm-pricing] Validating build-time invariants…\n",
  );
  // Dynamic import so a build-side syntax error never breaks the fetch path.
  const builder = await import("./build-agent-monitor.mjs");
  if (typeof builder.loadHostDefaultPricing !== "function") {
    throw new Error(
      "build-agent-monitor.mjs does not export loadHostDefaultPricing — was this script run against an incompatible builder?",
    );
  }
  const merged = builder.loadHostDefaultPricing();
  process.stdout.write(
    `[refresh-litellm-pricing] Invariants passed (${merged.length} rows merged with HOST_ONLY_OVERRIDES).\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `[refresh-litellm-pricing] FAIL: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});

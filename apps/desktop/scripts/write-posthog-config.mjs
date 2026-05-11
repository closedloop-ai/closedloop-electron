import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const generatedDir = path.join(appRoot, "resources", "generated");
const configPath = path.join(generatedDir, "posthog-config.json");

await mkdir(generatedDir, { recursive: true });

const apiKey = toNonEmptyString(process.env.CL_POSTHOG_API_KEY);
if (!apiKey) {
  await removeConfig();
  console.log("PostHog config not generated: CL_POSTHOG_API_KEY is not set.");
  process.exit(0);
}

if (!apiKey.startsWith("phc_")) {
  await removeConfig();
  console.warn(
    "PostHog config not generated: CL_POSTHOG_API_KEY must start with phc_.",
  );
  process.exit(0);
}

const host = toNonEmptyString(process.env.CL_POSTHOG_HOST) ?? POSTHOG_DEFAULT_HOST;
await writeFile(
  configPath,
  `${JSON.stringify({ apiKey, host }, null, 2)}\n`,
  { mode: 0o600 },
);
console.log("PostHog config generated for Desktop packaging.");

async function removeConfig() {
  await rm(configPath, { force: true });
}

function toNonEmptyString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getPackagingStageAppDir } from "./packaging-stage-path.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const stageAppDir = getPackagingStageAppDir();

await stat(stageAppDir).catch(() => {
  throw new Error("Packaging app is missing. Run `pnpm stage:package` before invoking electron-builder.");
});

const electronBuilderArgs = [
  "--mac",
  "--config",
  "electron-builder.yml",
  `-c.directories.app=${stageAppDir}`,
  ...process.argv.slice(2),
];

const electronBuilderResult = spawnSync("electron-builder", electronBuilderArgs, {
  cwd: appDir,
  stdio: "inherit",
});

if (electronBuilderResult.error) {
  throw electronBuilderResult.error;
}

process.exit(electronBuilderResult.status ?? 1);

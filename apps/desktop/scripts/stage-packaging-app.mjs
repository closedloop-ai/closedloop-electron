import { spawnSync } from "node:child_process";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appDir, "../..");
const stageRoot = path.join(appDir, ".electron-builder");
const stageAppDir = path.join(stageRoot, "app");
const buildOutputDir = path.join(appDir, "dist");
const stageBuildOutputDir = path.join(stageAppDir, "dist");
const rendererEntryFile = path.join(appDir, "src/renderer/index.html");
const stageRendererDir = path.join(stageAppDir, "src/renderer");

await rm(stageRoot, { recursive: true, force: true });
await mkdir(stageRoot, { recursive: true });

const deployResult = spawnSync(
  "pnpm",
  [
    "--dir",
    repoRoot,
    "--filter",
    "desktop",
    "deploy",
    "--legacy",
    "--prod",
    stageAppDir,
  ],
  {
    stdio: "inherit",
  },
);

if (deployResult.status !== 0) {
  process.exit(deployResult.status ?? 1);
}

await stat(buildOutputDir).catch(() => {
  throw new Error("apps/desktop/dist is missing. Run `pnpm build` before staging the packaging app.");
});

await cp(buildOutputDir, stageBuildOutputDir, { recursive: true });
await mkdir(stageRendererDir, { recursive: true });
await cp(rendererEntryFile, path.join(stageRendererDir, "index.html"));

import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getPackagingStageAppDir, getPackagingStageRoot } from "./packaging-stage-path.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appDir, "../..");
const stageRoot = getPackagingStageRoot();
const stageAppDir = getPackagingStageAppDir();
const buildOutputDir = path.join(appDir, "dist");
const packageJsonFile = path.join(appDir, "package.json");
const repoNpmrcFile = path.join(repoRoot, ".npmrc");
const stageRootPackageJsonFile = path.join(stageRoot, "package.json");
const stageBuildOutputDir = path.join(stageAppDir, "dist");
const rendererEntryFile = path.join(appDir, "src/renderer/index.html");
const stageRendererDir = path.join(stageAppDir, "src/renderer");
const stageNpmrcFile = path.join(stageAppDir, ".npmrc");

function resolveStageDependencySpec(packageJson, dependencyName, dependency) {
  if (typeof dependency.resolved === "string" && dependency.resolved.length > 0) {
    return dependency.resolved;
  }

  return (
    packageJson.dependencies?.[dependencyName]
    ?? packageJson.optionalDependencies?.[dependencyName]
    ?? dependency.version
  );
}

function parseJsonFromCommandOutput(output) {
  const trimmedOutput = output.trim();

  try {
    return JSON.parse(trimmedOutput);
  } catch {
    // pnpm may emit warnings before the JSON payload.
  }

  const startIndexCandidates = [
    trimmedOutput.indexOf("["),
    trimmedOutput.indexOf("{"),
  ].filter((index) => index >= 0);

  const startIndex = startIndexCandidates.length > 0 ? Math.min(...startIndexCandidates) : 0;

  for (let index = startIndex; index < trimmedOutput.length; index += 1) {
    const candidate = trimmedOutput.slice(startIndex, index + 1);

    try {
      return JSON.parse(candidate);
    } catch {
      // Keep scanning until the JSON closes.
    }
  }

  throw new Error("Failed to parse pnpm dependency output.");
}

const installedDependencyResult = spawnSync(
  "pnpm",
  ["list", "--prod", "--json", "--depth", "0", "--silent", "--loglevel=error"],
  {
    cwd: appDir,
    encoding: "utf8",
  },
);

if (installedDependencyResult.error) {
  throw installedDependencyResult.error;
}

if (installedDependencyResult.status !== 0) {
  process.stderr.write(installedDependencyResult.stdout ?? "");
  process.stderr.write(installedDependencyResult.stderr ?? "");
  process.exit(installedDependencyResult.status ?? 1);
}

const installedDependencyTree = parseJsonFromCommandOutput(installedDependencyResult.stdout ?? "");
const installedDependencies = installedDependencyTree[0]?.dependencies;

if (installedDependencies == null || Object.keys(installedDependencies).length === 0) {
  throw new Error("No installed production dependencies were found in apps/desktop.");
}

await rm(stageRoot, { recursive: true, force: true });
await mkdir(stageAppDir, { recursive: true });

const packageJson = JSON.parse(await readFile(packageJsonFile, "utf8"));
const repoNpmrc = await readFile(repoNpmrcFile, "utf8");
const stagePackageJson = {
  name: packageJson.name,
  version: packageJson.version,
  description: packageJson.description,
  author: packageJson.author,
  private: packageJson.private,
  type: packageJson.type,
  main: packageJson.main,
  dependencies: Object.fromEntries(
    Object.entries(installedDependencies)
      .map(([dependencyName, dependency]) => [
        dependencyName,
        resolveStageDependencySpec(packageJson, dependencyName, dependency),
      ]),
  ),
};
const stageRootPackageJson = {
  name: packageJson.name,
  version: packageJson.version,
  description: packageJson.description,
  author: packageJson.author,
  private: packageJson.private,
  type: packageJson.type,
  main: "app/dist/main/index.js",
};

await writeFile(
  path.join(stageAppDir, "package.json"),
  `${JSON.stringify(stagePackageJson, null, 2)}\n`,
);
await writeFile(
  stageRootPackageJsonFile,
  `${JSON.stringify(stageRootPackageJson, null, 2)}\n`,
);
await writeFile(
  stageNpmrcFile,
  [
    repoNpmrc.trimEnd(),
    "node-linker=hoisted",
    "minimum-release-age-exclude[]=@closedloop-ai/design-system",
    "minimum-release-age-exclude[]=@closedloop-ai/loops-api",
    "minimum-release-age-exclude[]=@pydantic/genai-prices",
    "",
  ].join("\n"),
);

const installResult = spawnSync(
  "pnpm",
  [
    "install",
    "--prod",
    "--ignore-workspace",
    "--prefer-offline",
    "--no-frozen-lockfile",
  ],
  {
    cwd: stageAppDir,
    stdio: "inherit",
  },
);

if (installResult.error) {
  throw installResult.error;
}

if (installResult.status !== 0) {
  process.exit(installResult.status ?? 1);
}

await stat(buildOutputDir).catch(() => {
  throw new Error("apps/desktop/dist is missing. Run `pnpm build` before staging the packaging app.");
});

await cp(buildOutputDir, stageBuildOutputDir, { recursive: true });
await mkdir(stageRendererDir, { recursive: true });
await cp(rendererEntryFile, path.join(stageRendererDir, "index.html"));

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const runtimeSourceRoots = ["src/main", "src/server", "src/shared"];
const importSpecifierPattern =
  /\bimport\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const runtimeFileExtensions = new Set([".cjs", ".js", ".json", ".mjs", ".node"]);

type ImportIssue = {
  filePath: string;
  packageName: string;
  specifier: string;
};

function collectTypeScriptFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files;
}

function parsePackageSubpath(specifier: string) {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:")
  ) {
    return null;
  }

  const segments = specifier.split("/");
  const packageName = specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
  const subpath = specifier.startsWith("@")
    ? segments.slice(2).join("/")
    : segments.slice(1).join("/");

  return subpath ? { packageName, subpath } : null;
}

function packageDefinesExports(packageName: string): boolean {
  const packageJsonPath = path.join("node_modules", packageName, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return true;
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    exports?: unknown;
  };
  return packageJson.exports !== undefined;
}

function findUnstableRuntimeSubpathImports(): ImportIssue[] {
  const files = runtimeSourceRoots.flatMap(collectTypeScriptFiles);
  const issues: ImportIssue[] = [];

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, "utf8");
    for (const match of source.matchAll(importSpecifierPattern)) {
      const specifier = match[1] ?? match[2];
      const parsed = parsePackageSubpath(specifier);
      if (!parsed) {
        continue;
      }
      if (runtimeFileExtensions.has(path.extname(parsed.subpath))) {
        continue;
      }
      if (packageDefinesExports(parsed.packageName)) {
        continue;
      }

      issues.push({ filePath, packageName: parsed.packageName, specifier });
    }
  }

  return issues;
}

describe("runtime ESM imports", () => {
  test("main/server dependency subpath imports are resolvable after tsc output", () => {
    const issues = findUnstableRuntimeSubpathImports();

    assert.deepEqual(
      issues,
      [],
      issues
        .map(
          (issue) =>
            `${issue.filePath} imports ${issue.specifier}; ${issue.packageName} has no package exports, so Node/Electron ESM needs a concrete file extension`,
        )
        .join("\n"),
    );
  });
});

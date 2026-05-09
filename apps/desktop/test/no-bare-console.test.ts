import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const consoleCallPattern = /console\.(log|warn|error)/;

function collectSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files;
}

function findConsoleMatches() {
  const sourceFiles = [
    ...collectSourceFiles(path.resolve("src/main")),
    ...collectSourceFiles(path.resolve("src/server")),
  ];
  const matches: string[] = [];

  for (const filePath of sourceFiles) {
    const relativePath = path.relative(process.cwd(), filePath);
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (consoleCallPattern.test(line)) {
        matches.push(`${relativePath}:${index + 1}:${line}`);
      }
    });
  }

  return matches;
}

describe("production console transport guard", () => {
  test("main/server console output is limited to GatewayLogger transport", () => {
    const matches = findConsoleMatches();

    assert.equal(matches.length, 3);
    assert.ok(
      matches.every((line) => line.startsWith("src/main/gateway-logger.ts:")),
    );
    assert.ok(matches.some((line) => line.includes("console.error")));
    assert.ok(matches.some((line) => line.includes("console.warn")));
    assert.ok(matches.some((line) => line.includes("console.log")));
  });
});

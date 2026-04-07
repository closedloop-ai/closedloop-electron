import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { OperationDispatcher } from "../src/server/operation-dispatcher.js";
import { registerLearningsRoutes } from "../src/server/operations/learnings.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

afterEach(async () => {
  process.env.HOME = originalHome;
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "learnings-route-test-"));
  tempDirs.push(dir);
  return dir;
}

function buildToon(summary: string): string {
  return [
    "patterns[1]{id,category,summary,confidence,seen_count,success_rate,flags,applies_to,context}:",
    `  pat-1,pattern,"${summary}",high,1,1.0,[KEEP],repo|all,chat`,
    "",
  ].join("\n");
}

async function dispatchGetLearnings(homeDir: string): Promise<{ statusCode: number; body: { patterns: Array<{ summary: string }> } }> {
  process.env.HOME = homeDir;

  const dispatcher = new OperationDispatcher();
  registerLearningsRoutes(dispatcher, () => []);

  let responseBody = "";
  const response = {
    statusCode: 0,
    setHeader() {},
    end(body?: string) {
      responseBody = body ?? "";
    },
  } as unknown as ServerResponse;

  const handled = await dispatcher.dispatch({
    method: "GET",
    pathname: "/api/engineer/learnings",
    params: {},
    query: new URLSearchParams(),
    rawBody: Buffer.alloc(0),
    body: "",
    request: {} as IncomingMessage,
    response,
  });

  assert.equal(handled, true);

  return {
    statusCode: (response as unknown as { statusCode: number }).statusCode,
    body: JSON.parse(responseBody) as { patterns: Array<{ summary: string }> },
  };
}

describe("registerLearningsRoutes GET /api/engineer/learnings", () => {
  test("prefers ~/.closedloop-ai/learnings/org-patterns.toon", async () => {
    const homeDir = await makeTempDir();
    await fs.mkdir(path.join(homeDir, ".closedloop-ai", "learnings"), { recursive: true });
    await fs.mkdir(path.join(homeDir, ".claude", ".learnings"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".closedloop-ai", "learnings", "org-patterns.toon"),
      buildToon("new-path"),
      "utf-8"
    );
    await fs.writeFile(
      path.join(homeDir, ".claude", ".learnings", "org-patterns.toon"),
      buildToon("legacy-path"),
      "utf-8"
    );

    const response = await dispatchGetLearnings(homeDir);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.patterns[0]?.summary, "new-path");
  });

  test("falls back to ~/.claude/.learnings/org-patterns.toon when needed", async () => {
    const homeDir = await makeTempDir();
    await fs.mkdir(path.join(homeDir, ".claude", ".learnings"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".claude", ".learnings", "org-patterns.toon"),
      buildToon("legacy-path"),
      "utf-8"
    );

    const response = await dispatchGetLearnings(homeDir);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.patterns[0]?.summary, "legacy-path");
  });
});

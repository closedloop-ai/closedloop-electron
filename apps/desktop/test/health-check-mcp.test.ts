import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import { describe, test } from "node:test";
import { OperationDispatcher } from "../src/server/operation-dispatcher.js";
import { registerHealthCheckRoutes } from "../src/server/operations/health-check.js";
import type { McpDetectionResult } from "../src/server/operations/mcp-detection.js";
import type { ProcessManager } from "../src/server/process-manager.js";

type CapturedResponse = {
  response: ServerResponse;
  chunks: string[];
  get statusCode(): number;
  get ended(): boolean;
};

function makeResponse(): CapturedResponse {
  let statusCode = 0;
  const chunks: string[] = [];
  let ended = false;
  const response = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
    setHeader() {},
    flushHeaders() {},
    socket: { setNoDelay() {} },
    write(chunk: unknown) {
      if (typeof chunk === "string") {
        chunks.push(chunk);
      }
      return true;
    },
    end(chunk?: unknown) {
      if (typeof chunk === "string") {
        chunks.push(chunk);
      }
      ended = true;
    },
  } as unknown as ServerResponse;

  return {
    response,
    chunks,
    get statusCode() {
      return statusCode;
    },
    get ended() {
      return ended;
    },
  };
}

async function dispatchHealthCheck(
  dispatcher: OperationDispatcher,
  expectedMcpUrl?: string
): Promise<CapturedResponse> {
  const captured = makeResponse();
  await dispatcher.dispatch({
    method: "GET",
    pathname: "/api/gateway/health-check",
    params: {},
    query: new URLSearchParams(
      expectedMcpUrl ? [["expectedMcpUrl", expectedMcpUrl]] : []
    ),
    rawBody: Buffer.alloc(0),
    body: "",
    request: {} as IncomingMessage,
    response: captured.response,
  });
  return captured;
}

function parsePayload(captured: CapturedResponse): Record<string, unknown> {
  return JSON.parse(captured.chunks.join("")) as Record<string, unknown>;
}

describe("registerHealthCheckRoutes — MCP injection", () => {
  const expectedMcpUrl = "https://mcp.closedloop.ai/mcp";

  test("response includes mcpServers from injected detectMcp stub", async () => {
    const dispatcher = new OperationDispatcher();
    const claudeStub: McpDetectionResult = {
      available: true,
      serverName: "team-prod",
      matchedUrl: expectedMcpUrl,
      checkedAt: "2026-04-12T00:00:00.000Z",
      closedloopAvailable: true,
    };
    const codexStub: McpDetectionResult = {
      available: false,
      serverName: "team-prod",
      matchedUrl: expectedMcpUrl,
      checkedAt: "2026-04-12T00:00:00.000Z",
      closedloopAvailable: false,
    };
    const detectMcp = async (
      provider: "claude" | "codex",
      _expectedMcpUrl?: string
    ): Promise<McpDetectionResult> =>
      provider === "claude" ? claudeStub : codexStub;

    registerHealthCheckRoutes(
      dispatcher,
      {} as unknown as ProcessManager,
      () => os.tmpdir(),
      detectMcp
    );

    const captured = await dispatchHealthCheck(dispatcher, expectedMcpUrl);
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.ended, true);

    const payload = parsePayload(captured);
    assert.ok(Array.isArray(payload.checks));
    assert.equal(typeof payload.allRequiredPassed, "boolean");

    const mcpServers = payload.mcpServers as Record<string, unknown>;
    assert.deepEqual(mcpServers.claude, claudeStub);
    assert.deepEqual(mcpServers.codex, codexStub);
  });

  test("invokes detectMcp once per provider with the correct argument", async () => {
    const dispatcher = new OperationDispatcher();
    const calls: Array<{ provider: "claude" | "codex"; expectedMcpUrl?: string }> = [];
    const detectMcp = async (
      provider: "claude" | "codex",
      expectedMcpUrlArg?: string
    ): Promise<McpDetectionResult> => {
      calls.push({ provider, expectedMcpUrl: expectedMcpUrlArg });
      return {
        available: true,
        serverName: "team-prod",
        matchedUrl: expectedMcpUrl,
        checkedAt: "2026-04-12T00:00:00.000Z",
        closedloopAvailable: true,
      };
    };

    registerHealthCheckRoutes(
      dispatcher,
      {} as unknown as ProcessManager,
      () => os.tmpdir(),
      detectMcp
    );

    await dispatchHealthCheck(dispatcher, expectedMcpUrl);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls, [
      { provider: "claude", expectedMcpUrl },
      { provider: "codex", expectedMcpUrl },
    ]);
  });

  test("includes mcpServers even when both providers report unavailable", async () => {
    const dispatcher = new OperationDispatcher();
    const detectMcp = async (): Promise<McpDetectionResult> => ({
      available: false,
      serverName: null,
      matchedUrl: null,
      checkedAt: "2026-04-12T00:00:00.000Z",
      closedloopAvailable: false,
    });

    registerHealthCheckRoutes(
      dispatcher,
      {} as unknown as ProcessManager,
      () => os.tmpdir(),
      detectMcp
    );

    const captured = await dispatchHealthCheck(dispatcher, expectedMcpUrl);
    const payload = parsePayload(captured);
    const mcpServers = payload.mcpServers as Record<
      string,
      { available: boolean; serverName: string | null; closedloopAvailable: boolean }
    >;
    assert.equal(mcpServers.claude.available, false);
    assert.equal(mcpServers.claude.serverName, null);
    assert.equal(mcpServers.claude.closedloopAvailable, false);
    assert.equal(mcpServers.codex.available, false);
    assert.equal(mcpServers.codex.serverName, null);
    assert.equal(mcpServers.codex.closedloopAvailable, false);
  });
});

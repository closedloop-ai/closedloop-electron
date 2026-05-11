import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import { afterEach, describe, test } from "node:test";
import { Observability } from "../src/main/observability.js";
import type { EnrichedTelemetryEvent } from "../src/main/telemetry-service.js";
import { OperationDispatcher } from "../src/server/operation-dispatcher.js";
import {
  _applyPluginVersionChecksForTesting,
  _getPluginUpdateStderrTailForTesting,
  _setPluginUpdateCommandForTesting,
  _shouldEnablePluginAutoUpdateForTesting,
  registerHealthCheckRoutes,
} from "../src/server/operations/health-check.js";
import type { McpDetectionResult } from "../src/server/operations/mcp-detection.js";
import type { ProcessManager } from "../src/server/process-manager.js";

type CapturedResponse = {
  response: ServerResponse;
  chunks: string[];
  get statusCode(): number;
  get ended(): boolean;
};

type CheckResultPayload = {
  id: string;
  label: string;
  required: boolean;
  passed: boolean;
  version?: string;
  error?: string;
  remediation?: string;
  updateAttempted?: boolean;
  updateOutcome?: "success" | "failed" | "timeout" | "skipped";
  updatePluginIds?: string[];
  remediationLinks?: Array<{ label: string; url: string }>;
};

const CLOSEDLOOP_PLUGINS = [
  { folder: "code", key: "code@closedloop-ai", label: "Symphony Plugin" },
  {
    folder: "self-learning",
    key: "self-learning@closedloop-ai",
    label: "Self-Learning Plugin",
  },
  { folder: "judges", key: "judges@closedloop-ai", label: "Judges Plugin" },
  {
    folder: "code-review",
    key: "code-review@closedloop-ai",
    label: "Code Review Plugin",
  },
  {
    folder: "platform",
    key: "platform@closedloop-ai",
    label: "Platform Plugin",
  },
] as const;
const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  _setPluginUpdateCommandForTesting();
  await Observability.shutdown();
  Observability.reset();
});

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
  options: { expectedMcpUrl?: string; latestVersion?: string } = {}
): Promise<CapturedResponse> {
  const captured = makeResponse();
  const query = new URLSearchParams();
  if (options.expectedMcpUrl) {
    query.set("expectedMcpUrl", options.expectedMcpUrl);
  }
  if (options.latestVersion !== undefined) {
    query.set("latestVersion", options.latestVersion);
  }

  await dispatcher.dispatch({
    method: "GET",
    pathname: "/api/gateway/health-check",
    params: {},
    query,
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

function getChecks(payload: Record<string, unknown>): CheckResultPayload[] {
  assert.ok(Array.isArray(payload.checks));
  return payload.checks as CheckResultPayload[];
}

function findAppVersion(payload: Record<string, unknown>): CheckResultPayload | undefined {
  return getChecks(payload).find((check) => check.id === "app-version");
}

function buildInstalledPluginVersions(version: string): Record<string, string> {
  return Object.fromEntries(
    CLOSEDLOOP_PLUGINS.map((plugin) => [plugin.key, version])
  );
}

function buildPassingPluginChecks(): CheckResultPayload[] {
  return CLOSEDLOOP_PLUGINS.map((plugin) => ({
    id: `plugin-${plugin.folder}`,
    label: plugin.label,
    required: true,
    passed: true,
  }));
}

function findPluginCheck(
  checks: CheckResultPayload[],
  folder: string
): CheckResultPayload | undefined {
  return checks.find((check) => check.id === `plugin-${folder}`);
}

function mockPluginManifestVersion(version: string): void {
  globalThis.fetch = (async () => Response.json({ version })) as typeof fetch;
}

const unavailableMcp = async (): Promise<McpDetectionResult> => ({
  available: false,
  serverName: null,
  matchedUrl: null,
  checkedAt: "2026-04-12T00:00:00.000Z",
  closedloopAvailable: false,
});

function registerHealthCheckWithAppVersion(
  dispatcher: OperationDispatcher,
  getAppVersion?: () => string | undefined
): void {
  registerHealthCheckRoutes(
    dispatcher,
    {} as unknown as ProcessManager,
    () => os.tmpdir(),
    unavailableMcp,
    undefined,
    getAppVersion
  );
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

    const captured = await dispatchHealthCheck(dispatcher, { expectedMcpUrl });
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.ended, true);

    const payload = parsePayload(captured);
    getChecks(payload);
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

    await dispatchHealthCheck(dispatcher, { expectedMcpUrl });
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

    const captured = await dispatchHealthCheck(dispatcher, { expectedMcpUrl });
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

describe("app-version check", () => {
  test("omits app-version when latestVersion is absent", async () => {
    const dispatcher = new OperationDispatcher();
    registerHealthCheckWithAppVersion(dispatcher, () => "1.0.0");

    const captured = await dispatchHealthCheck(dispatcher);
    const payload = parsePayload(captured);

    assert.equal(findAppVersion(payload), undefined);
  });

  test("passes when latestVersion equals currentVersion", async () => {
    const dispatcher = new OperationDispatcher();
    registerHealthCheckWithAppVersion(dispatcher, () => "1.0.0");

    const captured = await dispatchHealthCheck(dispatcher, { latestVersion: "1.0.0" });
    const appVersion = findAppVersion(parsePayload(captured));

    assert.deepEqual(appVersion, {
      id: "app-version",
      label: "Gateway Version",
      required: true,
      passed: true,
      version: "1.0.0",
    });
  });

  test("reports update availability as a required health check failure", async () => {
    const dispatcher = new OperationDispatcher();
    registerHealthCheckWithAppVersion(dispatcher, () => "1.0.0");

    const captured = await dispatchHealthCheck(dispatcher, { latestVersion: "2.0.0" });
    const payload = parsePayload(captured);
    const appVersion = findAppVersion(payload);

    assert.equal(appVersion?.required, true);
    assert.equal(appVersion?.passed, false);
    assert.equal(appVersion?.version, "1.0.0");
    assert.equal(appVersion?.error, "Update available: 2.0.0");
    assert.ok(appVersion?.remediation);
    assert.equal(payload.allRequiredPassed, false);
  });

  test("omits app-version when getAppVersion is not provided", async () => {
    const dispatcher = new OperationDispatcher();
    registerHealthCheckWithAppVersion(dispatcher);

    const captured = await dispatchHealthCheck(dispatcher, { latestVersion: "2.0.0" });
    const payload = parsePayload(captured);

    assert.equal(findAppVersion(payload), undefined);
  });

  test("omits app-version when getAppVersion returns undefined", async () => {
    const dispatcher = new OperationDispatcher();
    registerHealthCheckWithAppVersion(dispatcher, () => undefined);

    const captured = await dispatchHealthCheck(dispatcher, { latestVersion: "2.0.0" });
    const payload = parsePayload(captured);

    assert.equal(findAppVersion(payload), undefined);
  });

  test("reports unrecognized formats without failing the health check", async () => {
    const cases: Array<{
      name: string;
      currentVersion: string;
      latestVersion: string;
    }> = [
      { name: "current", currentVersion: "dev-build", latestVersion: "2.0.0" },
      { name: "latest", currentVersion: "1.0.0", latestVersion: "latest" },
    ];

    for (const testCase of cases) {
      const dispatcher = new OperationDispatcher();
      registerHealthCheckWithAppVersion(dispatcher, () => testCase.currentVersion);

      const captured = await dispatchHealthCheck(dispatcher, {
        latestVersion: testCase.latestVersion,
      });
      const appVersion = findAppVersion(parsePayload(captured));

      assert.equal(appVersion?.required, true, testCase.name);
      assert.equal(appVersion?.passed, true, testCase.name);
      assert.match(appVersion?.error ?? "", /unrecognized/i, testCase.name);
    }
  });

  test("normalizes a leading v prefix before comparing and formatting the update error", async () => {
    const dispatcher = new OperationDispatcher();
    registerHealthCheckWithAppVersion(dispatcher, () => "1.0.0");

    const captured = await dispatchHealthCheck(dispatcher, { latestVersion: "v2.0.0" });
    const appVersion = findAppVersion(parsePayload(captured));

    assert.equal(appVersion?.required, true);
    assert.equal(appVersion?.passed, false);
    assert.equal(appVersion?.version, "1.0.0");
    assert.equal(appVersion?.error, "Update available: 2.0.0");
  });
});

describe("plugin-version check", () => {
  test("keeps up-to-date plugin rows required and passing with installed versions", async () => {
    mockPluginManifestVersion("1.0.0");

    const checks = await _applyPluginVersionChecksForTesting(
      buildPassingPluginChecks(),
      buildInstalledPluginVersions("1.0.0")
    );

    assert.equal(
      checks.some((check) => check.id === "plugin-versions"),
      false
    );
    assert.deepEqual(findPluginCheck(checks, "code"), {
      id: "plugin-code",
      label: "Symphony Plugin",
      required: true,
      passed: true,
      version: "1.0.0",
    });
  });

  test("marks outdated plugin rows as required health check failures", async () => {
    mockPluginManifestVersion("2.0.0");
    let updateCalls = 0;
    _setPluginUpdateCommandForTesting(async () => {
      updateCalls += 1;
      return { outcome: "success", stdout: "", elapsedMs: 1 };
    });

    const checks = await _applyPluginVersionChecksForTesting(
      buildPassingPluginChecks(),
      buildInstalledPluginVersions("1.0.0")
    );
    const codePlugin = findPluginCheck(checks, "code");

    assert.equal(
      checks.some((check) => check.id === "plugin-versions"),
      false
    );
    assert.equal(codePlugin?.label, "Symphony Plugin");
    assert.equal(codePlugin?.required, true);
    assert.equal(codePlugin?.passed, false);
    assert.equal(codePlugin?.version, "1.0.0");
    assert.equal(codePlugin?.error, "Update available: 2.0.0");
    assert.match(
      codePlugin?.remediation ?? "",
      /claude plugin update code@closedloop-ai/
    );
    assert.equal(codePlugin?.updateAttempted, undefined);
    assert.equal(updateCalls, 0);
  });

  test("auto-update success returns post-update passing metadata only when opted in", async () => {
    mockPluginManifestVersion("2.0.0");
    const calls: string[] = [];
    _setPluginUpdateCommandForTesting(async (pluginRef) => {
      calls.push(pluginRef);
      return { outcome: "success", stdout: "", elapsedMs: 5 };
    });

    const checks = await _applyPluginVersionChecksForTesting(
      buildPassingPluginChecks(),
      buildInstalledPluginVersions("1.0.0"),
      {
        pluginAutoUpdateEnabled: true,
        readInstalledVersions: () => buildInstalledPluginVersions("2.0.0"),
      }
    );
    const codePlugin = findPluginCheck(checks, "code");

    assert.deepEqual(
      calls.sort(),
      CLOSEDLOOP_PLUGINS.map((plugin) => plugin.key).sort()
    );
    assert.equal(codePlugin?.passed, true);
    assert.equal(codePlugin?.version, "2.0.0");
    assert.equal(codePlugin?.updateAttempted, true);
    assert.equal(codePlugin?.updateOutcome, "success");
    assert.ok(codePlugin?.updatePluginIds?.includes("plugin-code"));
  });

  test("plugin auto-update is gated on a passing Claude CLI row", () => {
    assert.equal(
      _shouldEnablePluginAutoUpdateForTesting(true, [
        { id: "claude-cli", passed: false },
        { id: "plugin-code", passed: true },
      ]),
      false
    );
    assert.equal(
      _shouldEnablePluginAutoUpdateForTesting(true, [
        { id: "claude-cli", passed: true },
        { id: "plugin-code", passed: true },
      ]),
      true
    );
    assert.equal(
      _shouldEnablePluginAutoUpdateForTesting(false, [
        { id: "claude-cli", passed: true },
      ]),
      false
    );
  });

  test("auto-update success that remains outdated reports failed metadata and telemetry", async () => {
    mockPluginManifestVersion("2.0.0");
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
    });
    _setPluginUpdateCommandForTesting(async () => ({
      outcome: "success",
      stdout: "",
      elapsedMs: 5,
    }));

    const checks = await _applyPluginVersionChecksForTesting(
      buildPassingPluginChecks(),
      buildInstalledPluginVersions("1.0.0"),
      {
        pluginAutoUpdateEnabled: true,
        readInstalledVersions: () => buildInstalledPluginVersions("1.0.0"),
      }
    );
    const codePlugin = findPluginCheck(checks, "code");
    const failureTelemetry = telemetryEvents.find(
      (event) => event.category === "plugin_update.failed"
    );

    assert.equal(codePlugin?.passed, false);
    assert.equal(codePlugin?.version, "1.0.0");
    assert.equal(codePlugin?.updateAttempted, true);
    assert.equal(codePlugin?.updateOutcome, "failed");
    assert.equal(
      failureTelemetry?.diagnostics?.pluginUpdate?.failureReason,
      "still_outdated"
    );
    assert.equal(
      failureTelemetry?.diagnostics?.pluginUpdate?.outcomes[
        "code@closedloop-ai"
      ],
      "failed"
    );
  });

  test("plugin update failure telemetry falls back to bounded stdout tail", async () => {
    mockPluginManifestVersion("2.0.0");
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
    });
    _setPluginUpdateCommandForTesting(async () => ({
      outcome: "failed",
      stdout: `stdout-prefix-${"x".repeat(700)}-stdout-tail-cause`,
      elapsedMs: 5,
      exitCode: 1,
      failureReason: "command_failed",
    }));

    await _applyPluginVersionChecksForTesting(
      buildPassingPluginChecks(),
      buildInstalledPluginVersions("1.0.0"),
      {
        pluginAutoUpdateEnabled: true,
        readInstalledVersions: () => buildInstalledPluginVersions("1.0.0"),
      }
    );
    const failureTelemetry = telemetryEvents.find(
      (event) => event.category === "plugin_update.failed"
    );
    const stderrTail = failureTelemetry?.diagnostics?.pluginUpdate?.stderrTail;

    assert.equal(stderrTail?.length, 512);
    assert.equal(stderrTail?.includes("stdout-prefix-"), false);
    assert.equal(stderrTail?.endsWith("-stdout-tail-cause"), true);
  });

  test("auto-update failure returns explicit failure metadata and structured remediation link", async () => {
    mockPluginManifestVersion("2.0.0");
    _setPluginUpdateCommandForTesting(async () => ({
      outcome: "failed",
      stdout: "",
      stderrTail: "permission denied",
      elapsedMs: 5,
      exitCode: 1,
      failureReason: "command_failed",
    }));

    const checks = await _applyPluginVersionChecksForTesting(
      buildPassingPluginChecks(),
      buildInstalledPluginVersions("1.0.0"),
      {
        pluginAutoUpdateEnabled: true,
        readInstalledVersions: () => buildInstalledPluginVersions("1.0.0"),
      }
    );
    const codePlugin = findPluginCheck(checks, "code");

    assert.equal(codePlugin?.passed, false);
    assert.match(codePlugin?.error ?? "", /Automatic update was attempted/);
    assert.match(
      codePlugin?.remediation ?? "",
      /claude plugin update code@closedloop-ai --scope user/
    );
    assert.equal(codePlugin?.updateAttempted, true);
    assert.equal(codePlugin?.updateOutcome, "failed");
    assert.deepEqual(codePlugin?.remediationLinks, [
      {
        label: "Enable ClosedLoop plugin autoupdate",
        url: "https://github.com/closedloop-ai/claude-plugins#quick-start",
      },
    ]);
  });

  test("repeated failed auto-update tuple is suppressed in the same session", async () => {
    mockPluginManifestVersion("2.0.0");
    let calls = 0;
    _setPluginUpdateCommandForTesting(async () => {
      calls += 1;
      return {
        outcome: "timeout",
        stdout: "",
        stderrTail: "timed out",
        elapsedMs: 30_000,
        failureReason: "timeout",
      };
    });

    await _applyPluginVersionChecksForTesting(
      buildPassingPluginChecks(),
      buildInstalledPluginVersions("1.0.0"),
      {
        pluginAutoUpdateEnabled: true,
        readInstalledVersions: () => buildInstalledPluginVersions("1.0.0"),
      }
    );
    const secondChecks = await _applyPluginVersionChecksForTesting(
      buildPassingPluginChecks(),
      buildInstalledPluginVersions("1.0.0"),
      {
        pluginAutoUpdateEnabled: true,
        readInstalledVersions: () => buildInstalledPluginVersions("1.0.0"),
      }
    );
    const codePlugin = findPluginCheck(secondChecks, "code");

    assert.equal(calls, CLOSEDLOOP_PLUGINS.length);
    assert.equal(codePlugin?.updateOutcome, "skipped");
  });

  test("plugin update stderrTail preserves the stderr suffix", () => {
    const stderr = `prefix-${"x".repeat(700)}-tail-cause`;
    const tail = _getPluginUpdateStderrTailForTesting(stderr);

    assert.equal(tail.length, 512);
    assert.equal(tail.includes("prefix-"), false);
    assert.equal(tail.endsWith("-tail-cause"), true);
  });

  test("marks unverifiable plugin rows as required health check failures", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;

    const checks = await _applyPluginVersionChecksForTesting(
      buildPassingPluginChecks(),
      buildInstalledPluginVersions("1.0.0")
    );
    const codePlugin = findPluginCheck(checks, "code");

    assert.equal(
      checks.some((check) => check.id === "plugin-versions"),
      false
    );
    assert.equal(codePlugin?.label, "Symphony Plugin");
    assert.equal(codePlugin?.required, true);
    assert.equal(codePlugin?.passed, false);
    assert.equal(codePlugin?.error, "Could not verify latest version");
  });
});

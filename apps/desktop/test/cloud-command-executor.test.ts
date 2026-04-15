import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { afterEach, test } from "node:test";
import { CloudCommandExecutor } from "../src/main/cloud-command-executor.js";
import type {
  DesktopCancelEvent,
  DesktopCommandAckEvent,
  DesktopCommandEvent,
  DesktopCommandStreamEvent,
} from "../src/main/cloud-protocol.js";
import { Observability } from "../src/main/observability.js";

Observability.initNoOp();

let gatewayServer: http.Server | null = null;
let gatewayPort = 0;
let executor: CloudCommandExecutor | null = null;

afterEach(async () => {
  Observability.reset();
  executor?.dispose();
  executor = null;
  if (!gatewayServer) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    gatewayServer?.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  gatewayServer = null;
  gatewayPort = 0;
});

test("serializes conflicting lock keys while allowing parallel non-conflicting commands", async () => {
  const startOrder: string[] = [];
  let maxActive = 0;
  let active = 0;

  await startGateway(async (request, response, body) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const command = url.searchParams.get("command") ?? "unknown";
    startOrder.push(command);
    active += 1;
    maxActive = Math.max(maxActive, active);

    await sleep(80);
    active -= 1;

    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, command, body }));
  });

  const events: Array<
    Omit<
      DesktopCommandStreamEvent,
      "protocolVersion" | "messageId" | "timestamp"
    >
  > = [];
  executor = createExecutor({
    maxInFlightCommands: 2,
    onEvent: (event) => events.push(event),
  });
  executor.setConnected(true);

  executor.enqueue(
    buildCommand("c1", { command: "c1" }, { repoPath: "/repo/a" }),
  );
  executor.enqueue(
    buildCommand("c2", { command: "c2" }, { repoPath: "/repo/a" }),
  );
  executor.enqueue(
    buildCommand("c3", { command: "c3" }, { repoPath: "/repo/b" }),
  );

  await waitFor(
    () =>
      countDone(events, "c1") === 1 &&
      countDone(events, "c2") === 1 &&
      countDone(events, "c3") === 1,
  );

  assert.equal(maxActive, 2);
  const c2Index = startOrder.indexOf("c2");
  const c3Index = startOrder.indexOf("c3");
  assert.ok(
    c2Index > c3Index,
    `expected c3 to start before c2, got order: ${startOrder.join(",")}`,
  );
});

test("cancels queued command with terminal done(cancelled=true)", async () => {
  const started: string[] = [];

  await startGateway(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const command = url.searchParams.get("command") ?? "unknown";
    started.push(command);
    await sleep(120);
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, command }));
  });

  const events: Array<
    Omit<
      DesktopCommandStreamEvent,
      "protocolVersion" | "messageId" | "timestamp"
    >
  > = [];
  executor = createExecutor({
    maxInFlightCommands: 1,
    onEvent: (event) => events.push(event),
  });
  executor.setConnected(true);

  executor.enqueue(
    buildCommand("c1", { command: "c1" }, { repoPath: "/repo/a" }),
  );
  executor.enqueue(
    buildCommand("c2", { command: "c2" }, { repoPath: "/repo/b" }),
  );
  executor.cancel(buildCancel("c2", "user requested cancel"));

  await waitFor(
    () => countDone(events, "c1") === 1 && countDone(events, "c2") === 1,
  );

  const cancelledDone = events.find(
    (event) => event.commandId === "c2" && event.eventType === "done",
  );
  assert.ok(cancelledDone);
  assert.equal(
    (cancelledDone?.data as Record<string, unknown>).cancelled,
    true,
  );
  assert.deepEqual(started, ["c1"]);
});

test("emits terminal timeout error when command exceeds timeoutMs", async () => {
  await startGateway(async (_request, _response) => {
    await sleep(250);
  });

  const events: Array<
    Omit<
      DesktopCommandStreamEvent,
      "protocolVersion" | "messageId" | "timestamp"
    >
  > = [];
  executor = createExecutor({
    maxInFlightCommands: 1,
    onEvent: (event) => events.push(event),
  });
  executor.setConnected(true);

  executor.enqueue(
    buildCommand(
      "timeout-command",
      { command: "timeout-command" },
      { repoPath: "/repo/a", timeoutMs: 30 },
    ),
  );

  await waitFor(
    () =>
      events.some(
        (event) =>
          event.commandId === "timeout-command" &&
          event.eventType === "error" &&
          asRecord(event.data).terminal === true &&
          asRecord(event.data).code === "timeout",
      ),
    2000,
  );
});

test("replays buffered events from resume sequence", async () => {
  await startGateway(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const command = url.searchParams.get("command") ?? "unknown";
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, command }));
  });

  const events: Array<
    Omit<
      DesktopCommandStreamEvent,
      "protocolVersion" | "messageId" | "timestamp"
    >
  > = [];
  executor = createExecutor({
    maxInFlightCommands: 1,
    onEvent: (event) => events.push(event),
  });
  executor.setConnected(true);

  executor.enqueue(
    buildCommand(
      "replay-command",
      { command: "replay-command" },
      { repoPath: "/repo/a" },
    ),
  );
  await waitFor(() => countDone(events, "replay-command") === 1);

  const eventCountBeforeReplay = events.length;
  executor.replayFrom({ "replay-command": 1 });
  await waitFor(() => events.length > eventCountBeforeReplay);

  const replayed = events
    .slice(eventCountBeforeReplay)
    .filter((event) => event.commandId === "replay-command");
  assert.ok(replayed.every((event) => event.sequence > 1));
});

test("forwards request body for DELETE commands", async () => {
  let receivedBody = "";
  let receivedMethod = "";

  await startGateway(async (request, response, body) => {
    receivedMethod = request.method ?? "";
    receivedBody = body;
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });

  const events: Array<
    Omit<
      DesktopCommandStreamEvent,
      "protocolVersion" | "messageId" | "timestamp"
    >
  > = [];
  executor = createExecutor({
    maxInFlightCommands: 1,
    onEvent: (event) => events.push(event),
  });
  executor.setConnected(true);

  executor.enqueue({
    protocolVersion: "1",
    messageId: "delete-body-msg",
    timestamp: new Date().toISOString(),
    commandId: "delete-body",
    operationId: "git_worktree_delete",
    method: "DELETE",
    path: "/api/gateway/git/worktree",
    query: {},
    body: {
      worktreePath: "/repo/my-worktree",
      force: true,
    },
  });

  await waitFor(() => countDone(events, "delete-body") === 1);

  assert.equal(receivedMethod, "DELETE");
  const parsed = JSON.parse(receivedBody) as Record<string, unknown>;
  assert.equal(parsed.worktreePath, "/repo/my-worktree");
  assert.equal(parsed.force, true);
});

test("does not forward body for GET commands", async () => {
  let receivedBody = "";

  await startGateway(async (_request, response, body) => {
    receivedBody = body;
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });

  const events: Array<
    Omit<
      DesktopCommandStreamEvent,
      "protocolVersion" | "messageId" | "timestamp"
    >
  > = [];
  executor = createExecutor({
    maxInFlightCommands: 1,
    onEvent: (event) => events.push(event),
  });
  executor.setConnected(true);

  executor.enqueue({
    protocolVersion: "1",
    messageId: "get-nobody-msg",
    timestamp: new Date().toISOString(),
    commandId: "get-nobody",
    operationId: "status_check",
    method: "GET",
    path: "/api/gateway/symphony/status/TICKET-1",
    query: { repo: "/repo/a" },
    body: { shouldNotBeSent: true },
  });

  await waitFor(() => countDone(events, "get-nobody") === 1);

  assert.equal(receivedBody, "");
});

test("sends x-desktop-command-id and x-desktop-operation-id headers in gateway requests", async () => {
  let receivedCommandId: string | undefined;
  let receivedOperationId: string | undefined;

  const commandId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const operationId = "f1e2d3c4-b5a6-7890-abcd-ef1234567890";

  await startGateway(async (request, response) => {
    receivedCommandId = request.headers["x-desktop-command-id"] as
      | string
      | undefined;
    receivedOperationId = request.headers["x-desktop-operation-id"] as
      | string
      | undefined;
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });

  const events: Array<
    Omit<
      DesktopCommandStreamEvent,
      "protocolVersion" | "messageId" | "timestamp"
    >
  > = [];
  executor = createExecutor({
    maxInFlightCommands: 1,
    onEvent: (event) => events.push(event),
  });
  executor.setConnected(true);

  executor.enqueue({
    protocolVersion: "1",
    messageId: "header-test-msg",
    timestamp: new Date().toISOString(),
    commandId,
    operationId,
    method: "GET",
    path: "/api/gateway/git",
    query: {},
  });

  await waitFor(() => countDone(events, commandId) === 1);

  assert.equal(receivedCommandId, commandId);
  assert.equal(receivedOperationId, operationId);
});

test("omits x-desktop-command-id header when commandId is not a valid UUID", async () => {
  let receivedHeaders: http.IncomingHttpHeaders | undefined;

  await startGateway(async (request, response) => {
    receivedHeaders = request.headers;
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });

  const events: Array<
    Omit<
      DesktopCommandStreamEvent,
      "protocolVersion" | "messageId" | "timestamp"
    >
  > = [];
  executor = createExecutor({
    maxInFlightCommands: 1,
    onEvent: (event) => events.push(event),
  });
  executor.setConnected(true);

  // commandId with CRLF injection attempt — not a valid UUID
  const injectedCommandId = "not-a-uuid\r\nX-Injected: evil";
  executor.enqueue({
    protocolVersion: "1",
    messageId: "injection-test-msg",
    timestamp: new Date().toISOString(),
    commandId: injectedCommandId,
    operationId: "git_action",
    method: "GET",
    path: "/api/gateway/git",
    query: {},
  });

  await waitFor(() => countDone(events, injectedCommandId) === 1);

  assert.ok(receivedHeaders !== undefined);
  assert.equal(receivedHeaders["x-desktop-command-id"], undefined);
  assert.equal(receivedHeaders["x-injected"], undefined);
  // operationId "git_action" is a safe non-UUID value — header should be set
  assert.equal(receivedHeaders["x-desktop-operation-id"], "git_action");
});

test("omits x-desktop-operation-id header when operationId contains CRLF", async () => {
  let receivedHeaders: http.IncomingHttpHeaders | undefined;

  await startGateway(async (request, response) => {
    receivedHeaders = request.headers;
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });

  const events: Array<
    Omit<
      DesktopCommandStreamEvent,
      "protocolVersion" | "messageId" | "timestamp"
    >
  > = [];
  executor = createExecutor({
    maxInFlightCommands: 1,
    onEvent: (event) => events.push(event),
  });
  executor.setConnected(true);

  const commandId = crypto.randomUUID();
  executor.enqueue({
    protocolVersion: "1",
    messageId: "op-injection-test-msg",
    timestamp: new Date().toISOString(),
    commandId,
    operationId: "evil\r\nX-Injected: pwned",
    method: "GET",
    path: "/api/gateway/git",
    query: {},
  });

  await waitFor(() => countDone(events, commandId) === 1);

  assert.ok(receivedHeaders !== undefined);
  assert.equal(receivedHeaders["x-desktop-command-id"], commandId);
  assert.equal(receivedHeaders["x-desktop-operation-id"], undefined);
  assert.equal(receivedHeaders["x-injected"], undefined);
});

test("Observability.commandTimedOut is called on timeout", async () => {
  await startGateway(async () => {
    await sleep(250);
  });

  const calls: Array<{ commandId: string; operationId: string }> = [];
  const origMethod = Observability.commandTimedOut;
  try {
    Observability.commandTimedOut = (commandId: string, operationId: string) => {
      calls.push({ commandId, operationId });
      origMethod.call(Observability, commandId, operationId);
    };

    const commandEvents: Array<
      Omit<
        DesktopCommandStreamEvent,
        "protocolVersion" | "messageId" | "timestamp"
      >
    > = [];

    executor = createExecutor({
      maxInFlightCommands: 1,
      onEvent: (event) => commandEvents.push(event),
    });
    executor.setConnected(true);

    const commandId = "a1b2c3d4-e5f6-7890-abcd-111111111111";
    executor.enqueue(
      buildCommand(
        commandId,
        { command: commandId },
        { repoPath: "/repo/a", timeoutMs: 30 },
      ),
    );

    await waitFor(() => calls.length > 0, 2000);
    assert.equal(calls[0].commandId, commandId);
  } finally {
    Observability.commandTimedOut = origMethod;
  }
});

test("Observability.commandCancelled is called on cancel", async () => {
  await startGateway(async () => {
    await sleep(300);
  });

  const calls: Array<{ commandId: string }> = [];
  const origMethod = Observability.commandCancelled;
  try {
    Observability.commandCancelled = (commandId: string, _operationId: string) => {
      calls.push({ commandId });
      origMethod.call(Observability, commandId, _operationId);
    };

    const commandEvents: Array<
      Omit<
        DesktopCommandStreamEvent,
        "protocolVersion" | "messageId" | "timestamp"
      >
    > = [];

    executor = createExecutor({
      maxInFlightCommands: 1,
      onEvent: (event) => commandEvents.push(event),
    });
    executor.setConnected(true);

    const commandId = "a1b2c3d4-e5f6-7890-abcd-222222222222";
    executor.enqueue(
      buildCommand(commandId, { command: commandId }, { repoPath: "/repo/a" }),
    );

    await waitFor(() =>
      commandEvents.some(
        (e) => e.commandId === commandId && e.eventType === "status",
      ),
    );
    executor.cancel(buildCancel(commandId, "user requested cancel"));

    await waitFor(() => calls.length > 0, 2000);
    assert.equal(calls[0].commandId, commandId);
  } finally {
    Observability.commandCancelled = origMethod;
  }
});

test("Observability.commandFailed is called on gateway error", async () => {
  await startGateway(async (_request, response) => {
    response.statusCode = 500;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "internal server error" }));
  });

  const calls: Array<{ commandId: string }> = [];
  const origMethod = Observability.commandFailed;
  try {
    Observability.commandFailed = (commandId: string, _operationId: string, _errorClass: string) => {
      calls.push({ commandId });
      origMethod.call(Observability, commandId, _operationId, _errorClass);
    };

    const commandEvents: Array<
      Omit<
        DesktopCommandStreamEvent,
        "protocolVersion" | "messageId" | "timestamp"
      >
    > = [];

    executor = createExecutor({
      maxInFlightCommands: 1,
      onEvent: (event) => commandEvents.push(event),
    });
    executor.setConnected(true);

    const commandId = "a1b2c3d4-e5f6-7890-abcd-333333333333";
    executor.enqueue(
      buildCommand(commandId, { command: commandId }, { repoPath: "/repo/a" }),
    );

    await waitFor(() => calls.length > 0, 2000);
    assert.equal(calls[0].commandId, commandId);
  } finally {
    Observability.commandFailed = origMethod;
  }
});

function createExecutor(options: {
  maxInFlightCommands: number;
  onEvent: (
    event: Omit<
      DesktopCommandStreamEvent,
      "protocolVersion" | "messageId" | "timestamp"
    >,
  ) => void;
}): CloudCommandExecutor {
  return new CloudCommandExecutor({
    getGatewayPort: () => gatewayPort,
    getGatewayAuthToken: () => "test-gateway-token",
    maxInFlightCommands: options.maxInFlightCommands,
    sendCommandAck: () => {},
    sendCommandEvent: options.onEvent,
  });
}

function buildCommand(
  commandId: string,
  query: Record<string, string>,
  options?: {
    repoPath?: string;
    timeoutMs?: number;
  },
): DesktopCommandEvent {
  return {
    protocolVersion: "1",
    messageId: `${commandId}-message`,
    timestamp: new Date().toISOString(),
    commandId,
    operationId: "git_action",
    method: "POST",
    path: "/api/gateway/git",
    query,
    body: {
      action: "status",
      repoPath: options?.repoPath ?? "/repo/default",
    },
    timeoutMs: options?.timeoutMs,
  };
}

function buildCancel(commandId: string, reason: string): DesktopCancelEvent {
  return {
    protocolVersion: "1",
    messageId: `${commandId}-cancel`,
    timestamp: new Date().toISOString(),
    commandId,
    reason,
  };
}

function countDone(
  events: Array<
    Omit<
      DesktopCommandStreamEvent,
      "protocolVersion" | "messageId" | "timestamp"
    >
  >,
  commandId: string,
): number {
  return events.filter(
    (event) => event.commandId === commandId && event.eventType === "done",
  ).length;
}

async function startGateway(
  handler: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    body: string,
  ) => Promise<void>,
): Promise<void> {
  gatewayServer = http.createServer((request, response) => {
    void (async () => {
      const body = await readBody(request);
      await handler(request, response, body);
    })().catch((error) => {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          error:
            error instanceof Error
              ? error.message
              : "unknown test server failure",
        }),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    gatewayServer?.listen(0, "127.0.0.1", () => resolve());
    gatewayServer?.once("error", reject);
  });

  const address = gatewayServer.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test gateway server");
  }
  gatewayPort = address.port;
}

async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await sleep(15);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

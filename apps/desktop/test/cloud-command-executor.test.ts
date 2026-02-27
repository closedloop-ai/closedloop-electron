import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "node:test";
import { CloudCommandExecutor } from "../src/main/cloud-command-executor.js";
import type {
  DesktopCancelEvent,
  DesktopCommandAckEvent,
  DesktopCommandEvent,
  DesktopCommandStreamEvent
} from "../src/main/cloud-protocol.js";

let gatewayServer: http.Server | null = null;
let gatewayPort = 0;
let executor: CloudCommandExecutor | null = null;

afterEach(async () => {
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

  const events: Array<Omit<DesktopCommandStreamEvent, "protocolVersion" | "messageId" | "timestamp">> = [];
  executor = createExecutor({
    maxInFlightCommands: 2,
    onEvent: (event) => events.push(event)
  });

  executor.enqueue(buildCommand("c1", { command: "c1" }, { repoPath: "/repo/a" }));
  executor.enqueue(buildCommand("c2", { command: "c2" }, { repoPath: "/repo/a" }));
  executor.enqueue(buildCommand("c3", { command: "c3" }, { repoPath: "/repo/b" }));

  await waitFor(() => countDone(events, "c1") === 1 && countDone(events, "c2") === 1 && countDone(events, "c3") === 1);

  assert.equal(maxActive, 2);
  const c2Index = startOrder.indexOf("c2");
  const c3Index = startOrder.indexOf("c3");
  assert.ok(c2Index > c3Index, `expected c3 to start before c2, got order: ${startOrder.join(",")}`);
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

  const events: Array<Omit<DesktopCommandStreamEvent, "protocolVersion" | "messageId" | "timestamp">> = [];
  executor = createExecutor({
    maxInFlightCommands: 1,
    onEvent: (event) => events.push(event)
  });

  executor.enqueue(buildCommand("c1", { command: "c1" }, { repoPath: "/repo/a" }));
  executor.enqueue(buildCommand("c2", { command: "c2" }, { repoPath: "/repo/b" }));
  executor.cancel(buildCancel("c2", "user requested cancel"));

  await waitFor(() => countDone(events, "c1") === 1 && countDone(events, "c2") === 1);

  const cancelledDone = events.find(
    (event) => event.commandId === "c2" && event.eventType === "done"
  );
  assert.ok(cancelledDone);
  assert.equal((cancelledDone?.data as Record<string, unknown>).cancelled, true);
  assert.deepEqual(started, ["c1"]);
});

test("emits terminal timeout error when command exceeds timeoutMs", async () => {
  await startGateway(async (_request, _response) => {
    await sleep(250);
  });

  const events: Array<Omit<DesktopCommandStreamEvent, "protocolVersion" | "messageId" | "timestamp">> = [];
  executor = createExecutor({
    maxInFlightCommands: 1,
    onEvent: (event) => events.push(event)
  });

  executor.enqueue(
    buildCommand("timeout-command", { command: "timeout-command" }, { repoPath: "/repo/a", timeoutMs: 30 })
  );

  await waitFor(
    () =>
      events.some(
        (event) =>
          event.commandId === "timeout-command" &&
          event.eventType === "error" &&
          asRecord(event.data).terminal === true &&
          asRecord(event.data).code === "timeout"
      ),
    2000
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

  const events: Array<Omit<DesktopCommandStreamEvent, "protocolVersion" | "messageId" | "timestamp">> = [];
  executor = createExecutor({
    maxInFlightCommands: 1,
    onEvent: (event) => events.push(event)
  });

  executor.enqueue(buildCommand("replay-command", { command: "replay-command" }, { repoPath: "/repo/a" }));
  await waitFor(() => countDone(events, "replay-command") === 1);

  const eventCountBeforeReplay = events.length;
  executor.replayFrom({ "replay-command": 1 });
  await waitFor(() => events.length > eventCountBeforeReplay);

  const replayed = events.slice(eventCountBeforeReplay).filter((event) => event.commandId === "replay-command");
  assert.ok(replayed.every((event) => event.sequence > 1));
});

function createExecutor(options: {
  maxInFlightCommands: number;
  onEvent: (event: Omit<DesktopCommandStreamEvent, "protocolVersion" | "messageId" | "timestamp">) => void;
}): CloudCommandExecutor {
  const acks: Array<Omit<DesktopCommandAckEvent, "protocolVersion" | "messageId" | "timestamp">> = [];
  return new CloudCommandExecutor({
    getGatewayPort: () => gatewayPort,
    getGatewayAuthToken: () => "test-gateway-token",
    maxInFlightCommands: options.maxInFlightCommands,
    sendCommandAck: (event) => {
      acks.push(event);
    },
    sendCommandEvent: options.onEvent
  });
}

function buildCommand(
  commandId: string,
  query: Record<string, string>,
  options?: {
    repoPath?: string;
    timeoutMs?: number;
  }
): DesktopCommandEvent {
  return {
    protocolVersion: "1",
    messageId: `${commandId}-message`,
    timestamp: new Date().toISOString(),
    commandId,
    operationId: "git_action",
    method: "POST",
    path: "/api/engineer/git",
    query,
    body: {
      action: "status",
      repoPath: options?.repoPath ?? "/repo/default"
    },
    timeoutMs: options?.timeoutMs
  };
}

function buildCancel(commandId: string, reason: string): DesktopCancelEvent {
  return {
    protocolVersion: "1",
    messageId: `${commandId}-cancel`,
    timestamp: new Date().toISOString(),
    commandId,
    reason
  };
}

function countDone(
  events: Array<Omit<DesktopCommandStreamEvent, "protocolVersion" | "messageId" | "timestamp">>,
  commandId: string
): number {
  return events.filter((event) => event.commandId === commandId && event.eventType === "done").length;
}

async function startGateway(
  handler: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    body: string
  ) => Promise<void>
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
          error: error instanceof Error ? error.message : "unknown test server failure"
        })
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

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
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

import { openSync, readSync, closeSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { gatewayLog } from "../../main/gateway-logger.js";

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// JSONL record types (Claude CLI streaming output)
// ---------------------------------------------------------------------------

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = { type: "tool_use"; name: string; input?: Record<string, unknown> };
type ThinkingBlock = { type: "thinking" };
type ToolResultBlock = { type: "tool_result"; is_error?: boolean; content?: string | unknown[] };

type ContentBlock = TextBlock | ToolUseBlock | ThinkingBlock | ToolResultBlock;

type AssistantRecord = {
  type: "assistant";
  message: { content: ContentBlock[] };
};

type UserRecord = {
  type: "user";
  message: { content: ContentBlock[] };
};

type ContentBlockDeltaRecord = {
  type: "content_block_delta";
  delta: { type: "text_delta"; text: string };
};

type ResultRecord = {
  type: "result";
  subtype?: "success" | "error";
  is_error?: boolean;
  result?: string;
  error?: string;
};

export type JsonlRecord = AssistantRecord | UserRecord | ContentBlockDeltaRecord | ResultRecord;

function summarizeCodexRecord(record: Record<string, unknown>): string | null {
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return redactSensitive(truncate(record.output_text, 200));
  }
  if (typeof record.text === "string" && record.text.trim()) {
    return redactSensitive(truncate(record.text, 200));
  }
  if (record.type === "error" && typeof record.error === "string") {
    return redactSensitive(`Error: ${truncate(record.error, 200)}`);
  }

  const item = isRecord(record.item) ? record.item : null;
  if (item && typeof item.text === "string" && item.text.trim()) {
    return redactSensitive(truncate(item.text, 200));
  }

  if (record.type === "done") {
    return "Turn complete";
  }

  return null;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "..." : s;
}

function redactSensitive(input: string): string {
  return input
    .replace(/AKIA[A-Z0-9]{16}/g, "[REDACTED]")
    .replace(/sk-ant-[A-Za-z0-9\-_]+/g, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9]{32,}/g, "[REDACTED]")
    .replace(/Bearer [A-Za-z0-9._\-]+/g, "Bearer [REDACTED]")
    .replace(/-----BEGIN [A-Z ]+ KEY-----/g, "[REDACTED]");
}

function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  const filePath = input.file_path ?? input.path;
  if (typeof filePath === "string") return `Tool: ${name}(${truncate(filePath, 80)})`;
  if (typeof input.command === "string") return `Tool: ${name}(${truncate(input.command, 80)})`;
  if (typeof input.pattern === "string") return `Tool: ${name}(${truncate(input.pattern, 80)})`;
  return `Tool: ${name}`;
}

function summarizeToolResult(block: ToolResultBlock): string {
  if (block.is_error === true) return "Tool error";
  const content = block.content;
  if (typeof content === "string" && content.length > 0) return `Tool result: ${truncate(content, 120)}`;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
        return `Tool result: ${truncate(part.text, 120)}`;
      }
    }
  }
  return "Tool result";
}

/** Accepts a parsed JSONL record (untrusted) and returns a display summary, or null to skip. */
export function summarizeJsonlRecord(record: Record<string, unknown>): string | null {
  const codexSummary = summarizeCodexRecord(record);
  if (codexSummary) {
    return codexSummary;
  }

  const typed = record as JsonlRecord;

  switch (typed.type) {
    case "assistant":
    case "user": {
      const message = isRecord(typed.message) ? typed.message : null;
      if (!message) return null;
      const content = Array.isArray(message.content) ? (message.content as ContentBlock[]) : [];
      for (const block of content) {
        if (!isRecord(block)) continue;
        switch (block.type) {
          case "tool_use": {
            const b = block as ToolUseBlock;
            const input = isRecord(b.input) ? b.input : {};
            return redactSensitive(summarizeToolInput(String(b.name ?? "unknown"), input));
          }
          case "text":
            return redactSensitive(truncate(String((block as TextBlock).text ?? ""), 200));
          case "thinking":
            return redactSensitive("Thinking...");
          case "tool_result":
            return redactSensitive(summarizeToolResult(block as ToolResultBlock));
        }
      }
      return null;
    }
    case "content_block_delta": {
      const delta = isRecord(typed.delta) ? typed.delta : null;
      if (delta && (delta as ContentBlockDeltaRecord["delta"]).type === "text_delta") {
        return redactSensitive(truncate(String((delta as ContentBlockDeltaRecord["delta"]).text ?? ""), 200));
      }
      return null;
    }
    case "result": {
      const r = typed as ResultRecord;
      if (r.subtype === "success") {
        return redactSensitive("Turn complete");
      }
      if (r.subtype === "error" || r.is_error === true) {
        return redactSensitive(
          `Error: ${truncate(String(r.result ?? r.error ?? ""), 200)}`
        );
      }
      return null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// API communication
// ---------------------------------------------------------------------------

async function postLoopEvent(
  apiBaseUrl: string,
  loopId: string,
  token: string,
  event: { type: string; data: { chunk: string } }
): Promise<number | null> {
  const url = `${apiBaseUrl}/loops/${loopId}/events`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-loop-event-nonce": randomUUID(),
      },
      body: JSON.stringify({
        type: event.type,
        data: { chunk: event.data.chunk },
        timestamp: new Date().toISOString(),
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      gatewayLog.error(
        "output-tailer",
        `POST ${event.type} to ${url} failed: ${resp.status} ${resp.statusText} ${text}`,
      );
    }
    return resp.status;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    gatewayLog.error("output-tailer", `POST ${event.type} network error: ${msg}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Output tailer
// ---------------------------------------------------------------------------

const DEFAULT_POLL_MS = 2000;
const DEFAULT_THROTTLE_MS = 5000;
const DEFAULT_AUTH_RETRY_BASE_MS = 1000;
const DEFAULT_AUTH_RETRY_MAX_MS = 30000;
const DEFAULT_AUTH_RETRY_MAX_COUNT = 8;

type PollOptions = {
  ignoreBackoff?: boolean;
  forceAttempt?: boolean;
};

/**
 * Tail Claude JSONL output and POST summarized `output` events.
 *
 * `onOffset` receives only **replay-safe** byte offsets: after a full newline-delimited
 * frame is consumed, and — when an `output` POST is required — only after the server
 * accepts it (2xx). Partial tail bytes and rejected auth (401/403) never advance the
 * reported offset. Transient POST failures keep the frame buffered for retry.
 */
export function startOutputTailer(
  jsonlPath: string,
  apiBaseUrl: string,
  loopId: string,
  token: string,
  initialByteOffset: number,
  onOffset?: (offset: number) => void,
): { stop: () => void; flush: () => Promise<void> } {
  const pollIntervalMs = Number(process.env.CLOSEDLOOP_TAILER_POLL_MS) || DEFAULT_POLL_MS;
  const throttleMs = Number(process.env.CLOSEDLOOP_TAILER_THROTTLE_MS) || DEFAULT_THROTTLE_MS;
  const authRetryBaseMs =
    Number(process.env.CLOSEDLOOP_TAILER_AUTH_RETRY_BASE_MS) || DEFAULT_AUTH_RETRY_BASE_MS;
  const authRetryMaxMs =
    Number(process.env.CLOSEDLOOP_TAILER_AUTH_RETRY_MAX_MS) || DEFAULT_AUTH_RETRY_MAX_MS;
  const authRetryMaxCount =
    Number(process.env.CLOSEDLOOP_TAILER_AUTH_RETRY_MAX_COUNT) || DEFAULT_AUTH_RETRY_MAX_COUNT;
  let stopped = false;
  let authRetriesExhausted = false;
  let authRetryAttempt = 0;
  let nextAuthRetryAt = 0;
  /** Next byte to read from the JSONL file (may point past uncommitted tail in `pendingRemainder`). */
  let readByteOffset = initialByteOffset;
  /** Bytes read from disk not yet removed from `pendingRemainder` (no successful commit for that prefix). */
  let pendingRemainder = Buffer.alloc(0);
  let lastSentAt: number | null = null;
  /** Largest replay-safe offset reported via `onOffset` (exclusive end of committed prefix). */
  let committedByteOffset = initialByteOffset;

  function reportCommit(framedEndExclusive: number): void {
    if (framedEndExclusive > committedByteOffset) {
      committedByteOffset = framedEndExclusive;
      onOffset?.(committedByteOffset);
    }
  }

  function resetAuthRetryState(): void {
    authRetryAttempt = 0;
    nextAuthRetryAt = 0;
  }

  function shouldRetryAuthStatus(status: number | null): boolean {
    if (status === null) return true;
    if (status === 401 || status === 403) return true;
    return status >= 500;
  }

  function scheduleAuthRetry(status: number | null): void {
    authRetryAttempt += 1;
    if (authRetryAttempt > authRetryMaxCount) {
      authRetriesExhausted = true;
      gatewayLog.warn(
        "output-tailer",
        `Stopping tailer for loopId=${loopId}: exhausted auth retries after ${authRetryMaxCount} attempts (last status=${status ?? "network"})`,
      );
      return;
    }
    const delayMs = Math.min(authRetryMaxMs, authRetryBaseMs * 2 ** (authRetryAttempt - 1));
    nextAuthRetryAt = Date.now() + delayMs;
    gatewayLog.warn(
      "output-tailer",
      `Retrying output tailer for loopId=${loopId}: attempt=${authRetryAttempt}/${authRetryMaxCount} status=${status ?? "network"} backoffMs=${delayMs}`,
    );
  }

  async function pollOnce(options?: PollOptions): Promise<void> {
    const ignoreBackoff = options?.ignoreBackoff === true;
    const forceAttempt = options?.forceAttempt === true;
    if (stopped) return;
    if (authRetriesExhausted && !forceAttempt) return;
    if (!ignoreBackoff && nextAuthRetryAt > Date.now()) return;
    if (!existsSync(jsonlPath)) return;
    let fd: number | null = null;
    try {
      fd = openSync(jsonlPath, "r");
      const chunkSize = 65536;
      const chunk = Buffer.alloc(chunkSize);
      let bytesRead: number;
      while ((bytesRead = readSync(fd, chunk, 0, chunkSize, readByteOffset)) > 0) {
        readByteOffset += bytesRead;
        pendingRemainder = Buffer.concat([pendingRemainder, chunk.subarray(0, bytesRead)]);
      }
    } catch {
      return;
    } finally {
      if (fd !== null) closeSync(fd);
    }

    while (!stopped && (!authRetriesExhausted || forceAttempt)) {
      const newlineIndex = pendingRemainder.lastIndexOf(10); // 0x0a
      if (newlineIndex === -1) break;

      const baseInFile = readByteOffset - pendingRemainder.length;
      const framedEndExclusive = baseInFile + newlineIndex + 1;

      const completeLines = pendingRemainder.subarray(0, newlineIndex).toString("utf8");
      const suffix = pendingRemainder.subarray(newlineIndex + 1);

      let lastDisplay: string | null = null;
      for (const line of completeLines.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (!isRecord(parsed)) continue;
        const display = summarizeJsonlRecord(parsed);
        if (!display) continue;
        lastDisplay = display;
      }

      if (lastDisplay === null) {
        pendingRemainder = suffix;
        reportCommit(framedEndExclusive);
        continue;
      }

      const now = Date.now();
      if (lastSentAt !== null && now - lastSentAt < throttleMs) {
        break;
      }

      const status = await postLoopEvent(apiBaseUrl, loopId, token, { type: "output", data: { chunk: lastDisplay } });
      if (status !== null && status >= 200 && status < 300) {
        resetAuthRetryState();
        authRetriesExhausted = false;
        pendingRemainder = suffix;
        lastSentAt = now;
        reportCommit(framedEndExclusive);
        continue;
      }
      if (shouldRetryAuthStatus(status)) {
        scheduleAuthRetry(status);
      }
      break;
    }
  }

  const intervalId = setInterval(() => {
    pollOnce().catch((err) => {
      gatewayLog.error(
        "output-tailer",
        `Poll error for loopId=${loopId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }, pollIntervalMs);

  return {
    stop: () => { stopped = true; clearInterval(intervalId); },
    flush: async () => {
      clearInterval(intervalId);
      await pollOnce({ ignoreBackoff: true, forceAttempt: true });
      stopped = true;
    },
  };
}

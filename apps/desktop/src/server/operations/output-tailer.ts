import { openSync, readSync, closeSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

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
): Promise<void> {
  try {
    await fetch(`${apiBaseUrl}/loops/${loopId}/events`, {
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
  } catch (err) {
    console.error("[output-tailer] Failed to post loop event:", err);
  }
}

// ---------------------------------------------------------------------------
// Output tailer
// ---------------------------------------------------------------------------

export function startOutputTailer(
  jsonlPath: string,
  apiBaseUrl: string,
  loopId: string,
  token: string,
  initialByteOffset: number
): { stop: () => void; flush: () => Promise<void> } {
  let stopped = false;
  let byteOffset = initialByteOffset;
  let pendingRemainder = Buffer.alloc(0);
  let lastSentAt: number | null = null;

  async function pollOnce(): Promise<void> {
    if (stopped) return;
    if (!existsSync(jsonlPath)) return;
    let fd: number | null = null;
    try {
      fd = openSync(jsonlPath, "r");
      const chunkSize = 65536;
      const chunk = Buffer.alloc(chunkSize);
      let bytesRead: number;
      while ((bytesRead = readSync(fd, chunk, 0, chunkSize, byteOffset)) > 0) {
        byteOffset += bytesRead;
        pendingRemainder = Buffer.concat([pendingRemainder, chunk.subarray(0, bytesRead)]);
      }
    } catch {
      return;
    } finally {
      if (fd !== null) closeSync(fd);
    }

    const newlineIndex = pendingRemainder.lastIndexOf(10); // 0x0a = newline
    if (newlineIndex === -1) return;
    const completeLines = pendingRemainder.subarray(0, newlineIndex).toString("utf8");
    pendingRemainder = pendingRemainder.subarray(newlineIndex + 1);

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

    if (lastDisplay !== null) {
      const now = Date.now();
      if (lastSentAt === null || now - lastSentAt >= 5000) {
        lastSentAt = now;
        await postLoopEvent(apiBaseUrl, loopId, token, { type: "output", data: { chunk: lastDisplay } });
      }
    }
  }

  const intervalId = setInterval(() => { pollOnce().catch(() => {}); }, 2000);

  return {
    stop: () => { stopped = true; clearInterval(intervalId); },
    flush: async () => {
      clearInterval(intervalId);
      await pollOnce();
      stopped = true;
    },
  };
}

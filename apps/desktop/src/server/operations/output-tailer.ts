import { openSync, readSync, closeSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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

export function summarizeJsonlRecord(record: Record<string, unknown>): string | null {
  if (record.type === "assistant") {
    const message = isRecord(record.message) ? record.message : null;
    if (message) {
      const content = Array.isArray(message.content) ? (message.content as unknown[]) : [];
      for (const block of content) {
        if (!isRecord(block)) continue;
        if (block.type === "tool_use") {
          return redactSensitive(`Tool: ${String(block.name ?? "unknown")}`);
        }
        if (block.type === "text") {
          return redactSensitive(truncate(String(block.text ?? ""), 200));
        }
        if (block.type === "thinking") {
          return redactSensitive("Thinking...");
        }
      }
    }
    return null;
  }

  if (record.type === "user") {
    const message = isRecord(record.message) ? record.message : null;
    if (message) {
      const content = Array.isArray(message.content) ? (message.content as unknown[]) : [];
      for (const block of content) {
        if (!isRecord(block)) continue;
        if (block.type === "tool_result") {
          if (block.is_error === true) {
            return redactSensitive("Tool error");
          }
          return redactSensitive("Tool result");
        }
      }
    }
    return null;
  }

  if (record.type === "content_block_delta") {
    const delta = isRecord(record.delta) ? record.delta : null;
    if (delta && delta.type === "text_delta") {
      return redactSensitive(truncate(String(delta.text ?? ""), 200));
    }
    return null;
  }

  if (record.type === "result") {
    if (record.subtype === "success") {
      return redactSensitive("Turn complete");
    }
    if (record.subtype === "error" || record.is_error === true) {
      return redactSensitive(
        `Error: ${truncate(String(record.result ?? record.error ?? ""), 200)}`
      );
    }
    return null;
  }

  return null;
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

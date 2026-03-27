/**
 * LoopFinalizer: idempotent finalization for completed Symphony loop jobs.
 *
 * This module handles the three finalization steps for a loop that has exited:
 *   1. Artifact upload
 *   2. Completed-event POST
 *   3. Final status persistence in JobStore
 *
 * Each step is gated by a timestamp field on LocalJob, making the finalizer
 * safe to call multiple times (e.g., from live-exit and boot-recovery paths).
 *
 * Placed in main/ (not server/operations/) to avoid cross-layer import
 * violations: server/ must not import from main/, and this module is called by
 * supervision infrastructure that lives in main/.
 */

import crypto from "node:crypto";
import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import type { JobStore, LocalJob } from "./job-store.js";
import type { TelemetryEmitter } from "./telemetry-protocol.js";
import { gatewayLog } from "./gateway-logger.js";
import {
  TELEMETRY_LOG_TAIL_LINES,
  TELEMETRY_LOG_TAIL_MAX_BYTES,
} from "./telemetry-protocol.js";

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface LoopFinalizerDeps {
  /** Persistent store for active and terminal jobs. */
  jobStore: JobStore;
  /** Telemetry emitter for structured observability events. */
  telemetry: TelemetryEmitter;
  /**
   * Security assertion: throws DirectoryNotAllowedError if the path is outside
   * the configured sandbox. Signature mirrors server/security.ts#assertPathAllowed.
   */
  assertPathAllowed: (targetPath: string, allowedDirectories: string[]) => void;
  /** Bearer token for ClosedLoop API authentication. */
  apiAuthToken: string;
  /** Base URL for the ClosedLoop API (e.g. https://api.closedloop.ai). */
  apiBaseUrl: string;
  /**
   * Returns true if the process with the given PID is still running.
   * Injected to allow test isolation without spawning real processes.
   */
  isProcessRunning: (pid: number) => boolean;
}

// ---------------------------------------------------------------------------
// Finalization reason
// ---------------------------------------------------------------------------

export type LoopFinalizationReason = "live-exit" | "boot-recovery" | "manual-repair";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function finalizerLog(loopId: string, ...args: unknown[]): void {
  const short = loopId.slice(0, 8);
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[loop-finalizer][${ts}][${short}]`, ...args);
}

function finalizerWarn(loopId: string, ...args: unknown[]): void {
  const short = loopId.slice(0, 8);
  const ts = new Date().toISOString().slice(11, 23);
  console.warn(`[loop-finalizer][${ts}][${short}]`, ...args);
}

/**
 * Read and parse a JSON file; returns null if missing, empty, or invalid.
 * Inlined here to avoid importing from server/ (cross-layer violation).
 */
function readJsonFileSync(filePath: string): unknown | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function readTextFile(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/** Read up to TELEMETRY_LOG_TAIL_MAX_BYTES from the tail of a log file. */
function readLogTail(logPath: string): string | null {
  if (!existsSync(logPath)) {
    return null;
  }
  try {
    const stat = statSync(logPath);
    const fileSize = stat.size;
    if (fileSize === 0) {
      return null;
    }
    const readBytes = Math.min(fileSize, TELEMETRY_LOG_TAIL_MAX_BYTES);
    const offset = fileSize - readBytes;
    const buf = Buffer.alloc(readBytes);
    const fd = openSync(logPath, "r");
    try {
      readSync(fd, buf, 0, readBytes, offset);
    } finally {
      closeSync(fd);
    }
    const raw = buf.toString("utf-8");
    let tail: string;
    if (offset > 0) {
      const newlineIdx = raw.indexOf("\n");
      tail = newlineIdx === -1 ? raw : raw.slice(newlineIdx + 1);
    } else {
      tail = raw;
    }
    const lines = tail.split("\n");
    if (lines.length > TELEMETRY_LOG_TAIL_LINES) {
      return lines.slice(-TELEMETRY_LOG_TAIL_LINES).join("\n");
    }
    return tail;
  } catch {
    return null;
  }
}

const CREDENTIAL_PATTERNS: Array<[RegExp, string]> = [
  [/\b(AKIA|ASIA|AROA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_KEY]"],
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/g, "Bearer [REDACTED]"],
  [/\bsk-[A-Za-z0-9\-_]{10,}/g, "[REDACTED_SK_KEY]"],
  [/\b(ghp|gho|ghs|ghr)_[A-Za-z0-9]{36,}/g, "[REDACTED_GH_TOKEN]"],
  [/\b(password|secret|passwd|api_key|apikey|auth_token)=[^\s&"']+/gi, "$1=[REDACTED]"],
];

function redactCredentials(text: string): string {
  let result = text;
  for (const [pattern, replacement] of CREDENTIAL_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/:\/\/[^@]+@/g, "://***@")
    .replace(/\b[0-9a-f]{20,}\b/gi, "[REDACTED]")
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "[REDACTED]")
    .slice(0, 500);
}

/** Parse token usage from claude-output.jsonl */
function parseTokenUsage(claudeWorkDir: string): {
  inputTokens: number;
  outputTokens: number;
} {
  const totals = { inputTokens: 0, outputTokens: 0 };
  const outputFile = path.join(claudeWorkDir, "claude-output.jsonl");
  if (!existsSync(outputFile)) {
    return totals;
  }
  try {
    const content = readFileSync(outputFile, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.type === "assistant") {
          const message = entry.message as Record<string, unknown> | undefined;
          const usage = message?.usage as Record<string, number> | undefined;
          if (usage) {
            totals.inputTokens +=
              (usage.input_tokens ?? 0) +
              (usage.cache_creation_input_tokens ?? 0) +
              (usage.cache_read_input_tokens ?? 0);
            totals.outputTokens += usage.output_tokens ?? 0;
          }
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file read error
  }
  return totals;
}

/** Read artifacts from claudeWorkDir based on job command. */
function readArtifacts(
  command: string,
  claudeWorkDir: string,
  worktreeDir?: string,
): Record<string, unknown> {
  if (command === "PLAN" || command === "REQUEST_CHANGES") {
    const plan = readJsonFileSync(path.join(claudeWorkDir, "plan.json"));
    const openQuestions = readTextFile(path.join(claudeWorkDir, "open-questions.md"));
    const judges = readJsonFileSync(path.join(claudeWorkDir, "judges.json"));
    return {
      plan: plan ?? undefined,
      openQuestions: openQuestions ?? undefined,
      judges: judges ?? undefined,
    };
  }
  if (command === "EXECUTE") {
    const executionResult = readJsonFileSync(
      path.join(claudeWorkDir, "execution-result.json"),
    );
    const codeJudges = readJsonFileSync(path.join(claudeWorkDir, "code-judges.json"));
    return {
      executionResult: executionResult ?? undefined,
      codeJudges: codeJudges ?? undefined,
    };
  }
  if (command === "DECOMPOSE") {
    const features = readJsonFileSync(path.join(claudeWorkDir, "features.json"));
    return { features: features ?? undefined };
  }
  if (command === "EVALUATE_PRD") {
    const judges = readJsonFileSync(path.join(claudeWorkDir, "prd-judges.json"));
    return { prdJudges: judges ?? undefined };
  }
  if (command === "EVALUATE_PLAN") {
    const judges = readJsonFileSync(path.join(claudeWorkDir, "plan-judges.json"));
    return { planJudges: judges ?? undefined };
  }
  if (command === "EVALUATE_CODE") {
    const judges = readJsonFileSync(path.join(claudeWorkDir, "code-judges.json"));
    return { codeJudges: judges ?? undefined };
  }
  if (command === "GENERATE_PRD") {
    const baseDir = worktreeDir ?? claudeWorkDir;
    const prdContent = readTextFile(path.join(baseDir, "prd.md"));
    return { prd: prdContent ? { content: prdContent } : undefined };
  }
  return {};
}

async function postLoopEvent(
  apiBaseUrl: string,
  loopId: string,
  token: string,
  eventBody: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  const url = `${apiBaseUrl}/loops/${loopId}/events`;
  const payload: Record<string, unknown> = {
    ...eventBody,
    timestamp: eventBody.timestamp ?? new Date().toISOString(),
  };
  finalizerLog(loopId, `POST event: ${payload.type}`, url);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-loop-event-nonce": crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      finalizerWarn(loopId, `Event POST failed: ${resp.status} ${resp.statusText}`, text);
      gatewayLog.error(
        "loop-finalizer",
        `POST ${payload.type} to ${url} failed: ${resp.status} ${resp.statusText} ${text}`,
      );
      return { success: false, error: `HTTP ${resp.status} ${resp.statusText}` };
    }
    finalizerLog(loopId, `Event POST success: ${resp.status}`);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finalizerWarn(loopId, "Failed to post event:", err);
    gatewayLog.error("loop-finalizer", `POST ${payload.type} network error: ${msg}`);
    return { success: false, error: msg };
  }
}

async function uploadArtifacts(
  apiBaseUrl: string,
  loopId: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  const url = `${apiBaseUrl}/loops/${loopId}/upload-artifacts`;
  finalizerLog(loopId, "Uploading artifacts...", url);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      finalizerWarn(loopId, `Upload failed: ${resp.status} ${resp.statusText}`, text);
      gatewayLog.error(
        "loop-finalizer",
        `Artifact upload to ${url} failed: ${resp.status} ${resp.statusText} ${text}`,
      );
      return { success: false, error: `HTTP ${resp.status} ${resp.statusText}` };
    }
    finalizerLog(loopId, `Upload success: ${resp.status}`);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finalizerWarn(loopId, "Failed to upload artifacts:", err);
    gatewayLog.error("loop-finalizer", `Artifact upload network error: ${msg}`);
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Idempotently finalize a completed Symphony loop job.
 *
 * Steps (each guarded by a timestamp idempotency field):
 *   1. Upload artifacts from claudeWorkDir              → job.artifactsUploadedAt
 *   2. POST completed event to ClosedLoop API           → job.completedEventPostedAt
 *   3. Persist terminal status (COMPLETED) in JobStore  → job.finalStatusPersistedAt
 *
 * Entry guard: if job.status is CANCEL_PENDING and the PID is still alive,
 * the function returns immediately without taking any action.
 *
 * @param job    The LocalJob record from JobStore.
 * @param reason Why finalization is happening (used for telemetry category selection).
 * @param deps   Injected dependencies for testability and security.
 */
export async function finalizeLoopFromRuntime(
  job: LocalJob,
  reason: LoopFinalizationReason,
  deps: LoopFinalizerDeps,
): Promise<void> {
  const { jobStore, telemetry, assertPathAllowed, apiAuthToken, apiBaseUrl, isProcessRunning } = deps;
  const { loopId } = job;

  // Entry guard: if job is pending cancellation and process is still alive, bail out.
  if (job.status === "CANCEL_PENDING") {
    if (job.pid != null && isProcessRunning(job.pid)) {
      finalizerLog(loopId, "CANCEL_PENDING and process still alive — skipping finalization");
      return;
    }
  }

  const claudeWorkDir = job.claudeWorkDir;
  if (!claudeWorkDir) {
    finalizerWarn(loopId, "No claudeWorkDir on job — cannot finalize");
    return;
  }

  // Security: verify the work directory is inside the allowed sandbox before
  // any filesystem read.  allowedDirectories is derived from the job's own
  // claudeWorkDir (it must be allowed by definition) so we use it as a
  // self-contained single-entry allowlist.  Callers in boot-recovery paths
  // may pass a wider allowedDirectories list via the assertPathAllowed closure.
  try {
    assertPathAllowed(claudeWorkDir, [claudeWorkDir]);
  } catch (err) {
    finalizerWarn(loopId, "claudeWorkDir failed sandbox check — skipping finalization", err);
    gatewayLog.error(
      "loop-finalizer",
      `Security: claudeWorkDir=${claudeWorkDir} not in allowed directories for loopId=${loopId}`,
    );
    return;
  }

  const command = job.command;
  const worktreeDir = job.worktreeDir;
  const warnings: string[] = [];

  // ------------------------------------------------------------------
  // Step 1: Artifact upload (skip if already done)
  // ------------------------------------------------------------------
  let artifacts: Record<string, unknown> = {};
  const metadata: Record<string, unknown> = {};

  if (!job.artifactsUploadedAt) {
    finalizerLog(loopId, `Reading artifacts for command=${command}`);
    artifacts = readArtifacts(command, claudeWorkDir, worktreeDir);

    // Read session ID if available
    const sessionFile = path.join(claudeWorkDir, "session-id.txt");
    const sessionId = readTextFile(sessionFile);
    if (sessionId) {
      metadata.sessionId = sessionId.trim();
    }

    const artifactKeys = Object.keys(artifacts);
    finalizerLog(loopId, "Artifact keys:", artifactKeys);
    gatewayLog.info(
      "loop-finalizer",
      `Uploading artifacts for ${command} loopId=${loopId}: [${artifactKeys.join(", ")}]`,
    );

    const uploadResult = await uploadArtifacts(apiBaseUrl, loopId, apiAuthToken, {
      artifacts,
      metadata,
    });

    if (!uploadResult.success) {
      finalizerWarn(
        loopId,
        "Artifact upload failed:",
        uploadResult.error ?? "unknown error",
      );
      gatewayLog.warn(
        "loop-finalizer",
        `Artifact upload failed: ${uploadResult.error ?? "unknown error"}, loopId=${loopId}`,
      );
      warnings.push("ARTIFACT_UPLOAD_FAILED");
    } else {
      // Persist the idempotency timestamp
      const now = new Date().toISOString();
      const current = jobStore.getByLoopId(loopId) ?? job;
      jobStore.upsert({ ...current, artifactsUploadedAt: now, updatedAt: now });
    }
  } else {
    finalizerLog(loopId, `Skipping artifact upload — already done at ${job.artifactsUploadedAt}`);
    // Re-read metadata for use in the completed event (session ID)
    const sessionFile = path.join(claudeWorkDir, "session-id.txt");
    const sessionId = readTextFile(sessionFile);
    if (sessionId) {
      metadata.sessionId = sessionId.trim();
    }
    artifacts = readArtifacts(command, claudeWorkDir, worktreeDir);
  }

  // ------------------------------------------------------------------
  // Step 2: Post completed event (skip if already done)
  // ------------------------------------------------------------------
  if (!job.completedEventPostedAt) {
    const tokensUsed = parseTokenUsage(claudeWorkDir);
    finalizerLog(
      loopId,
      `Tokens used: input=${tokensUsed.inputTokens}, output=${tokensUsed.outputTokens}`,
    );

    const result: Record<string, unknown> = {
      exitCode: job.exitCode ?? 0,
      subtype: command.toLowerCase(),
    };

    if (command === "EXECUTE" && artifacts.executionResult) {
      const execResult = artifacts.executionResult as Record<string, unknown>;
      result.prUrl = execResult.pr_url;
      result.prNumber = execResult.pr_number;
      result.branchName = execResult.branch_name;
      result.has_changes = execResult.has_changes ?? false;
    }

    if (metadata.sessionId) {
      result.sessionId = metadata.sessionId;
    }

    const completedEvent: Record<string, unknown> = {
      type: "completed",
      result,
      tokensUsed: {
        input: tokensUsed.inputTokens,
        output: tokensUsed.outputTokens,
      },
      loopId,
      ...(warnings.length > 0 ? { warnings } : {}),
    };

    finalizerLog(loopId, "Posting completed event...");
    const eventResult = await postLoopEvent(apiBaseUrl, loopId, apiAuthToken, completedEvent);

    if (!eventResult.success) {
      finalizerWarn(loopId, "Completed event POST failed:", eventResult.error ?? "unknown error");
      gatewayLog.warn(
        "loop-finalizer",
        `Completed event POST failed: ${eventResult.error ?? "unknown error"}, loopId=${loopId}`,
      );
      warnings.push("EVENT_POST_FAILED");
    } else {
      // Persist the idempotency timestamp
      const now = new Date().toISOString();
      const current = jobStore.getByLoopId(loopId) ?? job;
      jobStore.upsert({ ...current, completedEventPostedAt: now, updatedAt: now });
    }
  } else {
    finalizerLog(loopId, `Skipping completed event — already posted at ${job.completedEventPostedAt}`);
  }

  // ------------------------------------------------------------------
  // Step 3: Persist final status (skip if already done)
  // ------------------------------------------------------------------
  if (!job.finalStatusPersistedAt) {
    finalizerLog(loopId, "Persisting final COMPLETED status");
    const now = new Date().toISOString();
    const current = jobStore.getByLoopId(loopId) ?? job;
    jobStore.upsert({
      ...current,
      status: "COMPLETED",
      exitCode: job.exitCode ?? 0,
      updatedAt: now,
      completedAt: current.completedAt ?? now,
      finalStatusPersistedAt: now,
      warning:
        warnings.length > 0
          ? warnings.map(sanitizeErrorMessage).join("; ")
          : undefined,
    });
    finalizerLog(loopId, "Loop finalized successfully");
  } else {
    finalizerLog(loopId, `Skipping status update — already persisted at ${job.finalStatusPersistedAt}`);
  }

  // ------------------------------------------------------------------
  // Telemetry: emit based on reason
  // ------------------------------------------------------------------
  const finalJob = jobStore.getByLoopId(loopId) ?? job;

  const telemetryCategory =
    reason === "live-exit"
      ? ("job.completed" as const)
      : reason === "boot-recovery"
        ? ("job.completed" as const)
        : ("job.completed" as const);

  const loopSessionId =
    typeof metadata.sessionId === "string" ? metadata.sessionId : undefined;

  // Collect diagnostics for non-live-exit reasons (boot-recovery / manual-repair)
  let diagnostics: { logTail?: string; tokenUsage?: { inputTokens: number; outputTokens: number } } | undefined;
  if (reason !== "live-exit") {
    const logPath = path.join(claudeWorkDir, "symphony-loop.log");
    const rawTail = readLogTail(logPath);
    const logTail = rawTail ? redactCredentials(rawTail) : undefined;
    const tokenUsage = parseTokenUsage(claudeWorkDir);
    if (logTail || tokenUsage.inputTokens > 0 || tokenUsage.outputTokens > 0) {
      diagnostics = { logTail, tokenUsage };
    }
  }

  telemetry.emit({
    severity: "info",
    category: telemetryCategory,
    message:
      reason === "live-exit"
        ? "Job completed successfully"
        : `Job finalized via ${reason}`,
    trace: {
      commandId: finalJob.commandId,
      operationId: finalJob.operationId,
      loopId,
      jobId: loopId,
      loopSessionId,
    },
    ...(diagnostics ? { diagnostics } : {}),
  });
}

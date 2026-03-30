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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  readLogTail,
  readTextFile,
  sanitizeErrorMessage,
} from "./diagnostics-helpers.js";
import { gatewayLog } from "./gateway-logger.js";
import type { JobStore, LocalJob } from "./job-store.js";
import type { TelemetryEmitter } from "./telemetry-protocol.js";
import { parseTokenUsage } from "./token-usage.js";

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
  gatewayLog.info(
    "loop-finalizer",
    `loopId=${loopId} POST event: ${String(payload.type)} ${url}`,
  );
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
      gatewayLog.error(
        "loop-finalizer",
        `POST ${payload.type} to ${url} failed: ${resp.status} ${resp.statusText} ${text}`,
      );
      return { success: false, error: `HTTP ${resp.status} ${resp.statusText}` };
    }
    gatewayLog.info("loop-finalizer", `loopId=${loopId} Event POST success: ${resp.status}`);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
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
  gatewayLog.info("loop-finalizer", `loopId=${loopId} Uploading artifacts... ${url}`);
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
      gatewayLog.error(
        "loop-finalizer",
        `Artifact upload to ${url} failed: ${resp.status} ${resp.statusText} ${text}`,
      );
      return { success: false, error: `HTTP ${resp.status} ${resp.statusText}` };
    }
    gatewayLog.info("loop-finalizer", `loopId=${loopId} Artifact upload success: ${resp.status}`);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
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
  const { jobStore, telemetry, apiAuthToken, apiBaseUrl, isProcessRunning } = deps;

  // Entry guard: if job is pending cancellation and process is still alive, bail out.
  if (job.status === "CANCEL_PENDING") {
    if (job.pid != null && isProcessRunning(job.pid)) {
      gatewayLog.info(
        "loop-finalizer",
        `loopId=${job.loopId} CANCEL_PENDING and process still alive — skipping finalization`,
      );
      return;
    }
  }

  const claudeWorkDir = job.claudeWorkDir;
  if (!claudeWorkDir) {
    gatewayLog.warn(
      "loop-finalizer",
      `loopId=${job.loopId} No claudeWorkDir on job — cannot finalize`,
    );
    return;
  }

  const command = job.command;
  const worktreeDir = job.worktreeDir;
  const warnings: string[] = job.warning
    ? job.warning
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    : [];

  // ------------------------------------------------------------------
  // Step 1: Artifact upload (skip if already done)
  // ------------------------------------------------------------------
  let artifacts: Record<string, unknown> = {};

  if (!job.artifactsUploadedAt) {
    gatewayLog.info(
      "loop-finalizer",
      `Reading artifacts loopId=${job.loopId} command=${command}`,
    );
    artifacts = readArtifacts(command, claudeWorkDir, worktreeDir);

    const artifactKeys = Object.keys(artifacts);
    gatewayLog.info(
      "loop-finalizer",
      `Uploading artifacts for ${command} loopId=${job.loopId}: [${artifactKeys.join(", ")}]`,
    );

    const uploadResult = await uploadArtifacts(apiBaseUrl, job.loopId, apiAuthToken, {
      artifacts,
      metadata: {
        finishedAt: new Date().toISOString(),
        command: command.toLowerCase(),
      },
    });

    if (!uploadResult.success) {
      gatewayLog.warn(
        "loop-finalizer",
        `Artifact upload failed: ${uploadResult.error ?? "unknown error"}, loopId=${job.loopId}`,
      );
      warnings.push("ARTIFACT_UPLOAD_FAILED");
    } else {
      // Persist the idempotency timestamp
      const now = new Date().toISOString();
      const current = jobStore.getByLoopId(job.loopId) ?? job;
      jobStore.upsert({ ...current, artifactsUploadedAt: now, updatedAt: now });
    }
  } else {
    gatewayLog.info(
      "loop-finalizer",
      `loopId=${job.loopId} Skipping artifact upload — already done at ${job.artifactsUploadedAt}`,
    );
    artifacts = readArtifacts(command, claudeWorkDir, worktreeDir);
  }

  // ------------------------------------------------------------------
  // Step 2: Post completed event (skip if already done)
  // ------------------------------------------------------------------
  if (!job.completedEventPostedAt) {
    const tokensUsed = parseTokenUsage(claudeWorkDir);
    gatewayLog.info(
      "loop-finalizer",
      `loopId=${job.loopId} Tokens used: input=${tokensUsed.inputTokens}, output=${tokensUsed.outputTokens}`,
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

    const completedEvent: Record<string, unknown> = {
      type: "completed",
      result,
      tokensUsed: {
        input: tokensUsed.inputTokens,
        output: tokensUsed.outputTokens,
      },
      loopId: job.loopId,
      ...(warnings.length > 0 ? { warnings } : {}),
    };

    gatewayLog.info("loop-finalizer", `loopId=${job.loopId} Posting completed event...`);
    const eventResult = await postLoopEvent(apiBaseUrl, job.loopId, apiAuthToken, completedEvent);

    if (!eventResult.success) {
      gatewayLog.warn(
        "loop-finalizer",
        `Completed event POST failed: ${eventResult.error ?? "unknown error"}, loopId=${job.loopId}`,
      );
      warnings.push("EVENT_POST_FAILED");
    } else {
      // Persist the idempotency timestamp
      const now = new Date().toISOString();
      const current = jobStore.getByLoopId(job.loopId) ?? job;
      jobStore.upsert({ ...current, completedEventPostedAt: now, updatedAt: now });
    }
  } else {
    gatewayLog.info(
      "loop-finalizer",
      `loopId=${job.loopId} Skipping completed event — already posted at ${job.completedEventPostedAt}`,
    );
  }

  // ------------------------------------------------------------------
  // Step 3: Persist final status (skip if already done)
  // ------------------------------------------------------------------
  if (!job.finalStatusPersistedAt) {
    gatewayLog.info("loop-finalizer", `loopId=${job.loopId} Persisting final COMPLETED status`);
    const now = new Date().toISOString();
    const current = jobStore.getByLoopId(job.loopId) ?? job;
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
    gatewayLog.info("loop-finalizer", `loopId=${job.loopId} Loop finalized successfully`);
  } else {
    gatewayLog.info(
      "loop-finalizer",
      `loopId=${job.loopId} Skipping status update — already persisted at ${job.finalStatusPersistedAt}`,
    );
  }

  // ------------------------------------------------------------------
  // Telemetry: emit based on reason
  // ------------------------------------------------------------------
  const finalJob = jobStore.getByLoopId(job.loopId) ?? job;

  const telemetryCategory =
    reason === "live-exit"
      ? ("job.completed" as const)
      : ("job.recovery.finalize_replayed" as const);

  // Collect diagnostics for non-live-exit reasons (boot-recovery / manual-repair)
  let diagnostics: { logTail?: string; tokenUsage?: { inputTokens: number; outputTokens: number } } | undefined;
  if (reason !== "live-exit") {
    const logPath = path.join(claudeWorkDir, "symphony-loop.log");
    const rawTail = readLogTail(logPath);
    const logTail = rawTail ?? undefined;
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
      loopId: job.loopId,
      jobId: job.loopId,
    },
    ...(diagnostics ? { diagnostics } : {}),
  });
}

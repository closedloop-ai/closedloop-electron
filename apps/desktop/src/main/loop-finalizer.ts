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
import type { LoopTokenStore } from "./loop-token-store.js";
import type { TelemetryEmitter } from "./telemetry-protocol.js";
import { parseTokenUsage } from "./token-usage.js";

export interface LoopFinalizerDeps {
  jobStore: JobStore;
  telemetry: TelemetryEmitter;
  apiAuthToken: string;
  apiBaseUrl: string;
  isProcessRunning: (pid: number) => boolean;
  /** When set, successful finalization removes the persisted loop runner token. */
  loopTokenStore?: LoopTokenStore;
}

export type LoopFinalizationReason =
  | "live-exit"
  | "boot-recovery"
  | "manual-repair";

export function parseJobWarnings(job: Pick<LocalJob, "warning">): string[] {
  if (!job.warning) {
    return [];
  }
  return job.warning
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

type ArtifactUploadDeps = Pick<LoopFinalizerDeps, "jobStore" | "apiAuthToken" | "apiBaseUrl">;

export async function tryUploadArtifacts(
  job: LocalJob,
  command: string,
  claudeWorkDir: string,
  worktreeDir: string | undefined,
  warnings: string[],
  deps: ArtifactUploadDeps,
): Promise<{ artifacts: Record<string, unknown>; failed: boolean }> {
  const artifacts = readArtifacts(command, claudeWorkDir, worktreeDir);
  if (job.artifactsUploadedAt) {
    return { artifacts, failed: false };
  }

  const uploadResult = await uploadArtifacts(deps.apiBaseUrl, job.loopId, deps.apiAuthToken, {
    artifacts,
    metadata: {
      finishedAt: new Date().toISOString(),
      command: command.toLowerCase(),
    },
  });
  if (!uploadResult.success) {
    warnings.push("ARTIFACT_UPLOAD_FAILED");
    return { artifacts, failed: true };
  }

  const now = new Date().toISOString();
  const current = deps.jobStore.getByLoopId(job.loopId) ?? job;
  deps.jobStore.upsert({
    ...current,
    artifactsUploadedAt: now,
    updatedAt: now,
  });
  return { artifacts, failed: false };
}

export async function tryPostCompletedEvent(
  job: LocalJob,
  command: string,
  claudeWorkDir: string,
  artifacts: Record<string, unknown>,
  warnings: string[],
  deps: ArtifactUploadDeps,
): Promise<boolean> {
  if (job.completedEventPostedAt) {
    return false;
  }

  const tokensUsed = parseTokenUsage(claudeWorkDir);
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

  const eventResult = await postLoopEvent(
    deps.apiBaseUrl,
    job.loopId,
    deps.apiAuthToken,
    completedEvent,
  );
  if (!eventResult.success) {
    warnings.push("EVENT_POST_FAILED");
    return true;
  }

  const now = new Date().toISOString();
  const current = deps.jobStore.getByLoopId(job.loopId) ?? job;
  deps.jobStore.upsert({
    ...current,
    completedEventPostedAt: now,
    updatedAt: now,
  });
  return false;
}

export async function tryPostErrorEvent(
  job: LocalJob,
  claudeWorkDir: string,
  warnings: string[],
  deps: ArtifactUploadDeps,
): Promise<boolean> {
  if (job.completedEventPostedAt) {
    return false;
  }

  const tokenUsage = parseTokenUsage(claudeWorkDir);
  const logTail = readLogTail(path.join(claudeWorkDir, "symphony-loop.log")) ?? undefined;
  const errorCode = job.status === "FAILED" ? "PROCESS_FAILED" : "PROCESS_STOPPED";
  const errorMessage =
    job.status === "FAILED"
      ? `Process exited with code ${job.exitCode ?? 1}`
      : `Process ended with terminal status ${job.status}`;
  const errorEvent: Record<string, unknown> = {
    type: "error",
    code: errorCode,
    message: errorMessage,
    loopId: job.loopId,
    ...(tokenUsage.inputTokens > 0 || tokenUsage.outputTokens > 0 ? { tokenUsage } : {}),
    ...(logTail ? { logTail } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };

  const eventResult = await postLoopEvent(
    deps.apiBaseUrl,
    job.loopId,
    deps.apiAuthToken,
    errorEvent,
  );
  if (!eventResult.success) {
    warnings.push("EVENT_POST_FAILED");
    return true;
  }

  const now = new Date().toISOString();
  const current = deps.jobStore.getByLoopId(job.loopId) ?? job;
  deps.jobStore.upsert({
    ...current,
    completedEventPostedAt: now,
    updatedAt: now,
  });
  return false;
}

export function persistFinalJobStatus(
  job: LocalJob,
  isSuccessStatus: boolean,
  warnings: string[],
  jobStore: JobStore,
): void {
  if (job.finalStatusPersistedAt) {
    return;
  }

  const now = new Date().toISOString();
  const current = jobStore.getByLoopId(job.loopId) ?? job;
  jobStore.upsert({
    ...current,
    status: isSuccessStatus ? "COMPLETED" : job.status,
    exitCode: job.exitCode ?? 0,
    updatedAt: now,
    completedAt: current.completedAt ?? now,
    finalStatusPersistedAt: now,
    warning:
      warnings.length > 0
        ? warnings.map((value) => sanitizeErrorMessage(value)).join("; ")
        : undefined,
  });
}

export function emitFinalizationTelemetry(
  job: LocalJob,
  reason: LoopFinalizationReason,
  claudeWorkDir: string,
  isSuccessStatus: boolean,
  telemetry: TelemetryEmitter,
  jobStore: JobStore,
): void {
  const finalJob = jobStore.getByLoopId(job.loopId) ?? job;
  const telemetryCategory =
    reason === "live-exit"
      ? ("job.completed" as const)
      : ("job.recovery.finalize_replayed" as const);

  let diagnostics:
    | { logTail?: string; tokenUsage?: { inputTokens: number; outputTokens: number } }
    | undefined;
  if (reason !== "live-exit") {
    const logPath = path.join(claudeWorkDir, "symphony-loop.log");
    const logTail = readLogTail(logPath) ?? undefined;
    const tokenUsage = parseTokenUsage(claudeWorkDir);
    if (logTail || tokenUsage.inputTokens > 0 || tokenUsage.outputTokens > 0) {
      diagnostics = { logTail, tokenUsage };
    }
  }

  const telemetrySeverity =
    reason === "live-exit" || isSuccessStatus || job.status === "CANCELLED"
      ? "info"
      : "error";
  const telemetryMessage =
    reason === "live-exit"
      ? "Job completed successfully"
      : isSuccessStatus
        ? `Job finalized via ${reason}`
        : job.status === "CANCELLED"
          ? `Job cancellation finalized via ${reason}`
          : `Job finalized with status ${job.status} via ${reason}`;

  telemetry.emit({
    severity: telemetrySeverity,
    category: telemetryCategory,
    message: telemetryMessage,
    trace: {
      commandId: finalJob.commandId,
      operationId: finalJob.operationId,
      loopId: job.loopId,
      jobId: job.loopId,
    },
    ...(diagnostics ? { diagnostics } : {}),
  });
}

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
      return { success: false, error: `HTTP ${resp.status} ${resp.statusText} ${text}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function uploadArtifacts(
  apiBaseUrl: string,
  loopId: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  const url = `${apiBaseUrl}/loops/${loopId}/upload-artifacts`;
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
      return { success: false, error: `HTTP ${resp.status} ${resp.statusText} ${text}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function finalizeLoopFromRuntime(
  job: LocalJob,
  reason: LoopFinalizationReason,
  deps: LoopFinalizerDeps,
): Promise<void> {
  const { jobStore, telemetry, apiAuthToken, apiBaseUrl, isProcessRunning, loopTokenStore } =
    deps;

  if (job.status === "CANCEL_PENDING" && job.pid != null && isProcessRunning(job.pid)) {
    gatewayLog.info(
      "loop-finalizer",
      `loopId=${job.loopId} cancellation pending and PID still alive; skip`,
    );
    return;
  }

  const claudeWorkDir = job.claudeWorkDir;
  if (!claudeWorkDir) {
    gatewayLog.warn("loop-finalizer", `loopId=${job.loopId} missing claudeWorkDir`);
    return;
  }

  const command = String(job.command);
  const worktreeDir = job.worktreeDir;
  const warnings = parseJobWarnings(job);

  const isSuccessStatus = job.status === "COMPLETED" || job.status === "RUNNING";
  const shouldPostErrorEvent =
    job.status === "FAILED" ||
    job.status === "STOPPED" ||
    job.status === "UNKNOWN";

  const artifactDeps = { jobStore, apiAuthToken, apiBaseUrl };
  let artifactUploadFailedThisRun = false;
  let completedEventFailedThisRun = false;

  if (isSuccessStatus) {
    const { artifacts, failed } = await tryUploadArtifacts(
      job,
      command,
      claudeWorkDir,
      worktreeDir,
      warnings,
      artifactDeps,
    );
    artifactUploadFailedThisRun = failed;
    const eventFailed = await tryPostCompletedEvent(
      job,
      command,
      claudeWorkDir,
      artifacts,
      warnings,
      artifactDeps,
    );
    completedEventFailedThisRun = eventFailed;
  } else if (shouldPostErrorEvent) {
    completedEventFailedThisRun = await tryPostErrorEvent(
      job,
      claudeWorkDir,
      warnings,
      artifactDeps,
    );
  }

  persistFinalJobStatus(job, isSuccessStatus, warnings, jobStore);
  emitFinalizationTelemetry(
    job,
    reason,
    claudeWorkDir,
    isSuccessStatus,
    telemetry,
    jobStore,
  );

  if (
    loopTokenStore &&
    !artifactUploadFailedThisRun &&
    !completedEventFailedThisRun
  ) {
    loopTokenStore.deleteLoopToken(job.loopId);
  }
}

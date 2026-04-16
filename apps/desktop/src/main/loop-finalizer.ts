import { execFileSync } from "node:child_process";
import { getResolvedGitPath } from "../server/operations/symphony-loop.js";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LoopErrorCode } from "@closedloop-ai/loops-api/error-codes";
import { LoopEventType } from "@closedloop-ai/loops-api/events";
import { parseExecutionResultFile } from "@closedloop-ai/loops-api/execution-result";
import {
  readLogTail,
  readTextFile,
  sanitizeErrorMessage,
} from "./diagnostics-helpers.js";
import { gatewayLog } from "./gateway-logger.js";
import {
  isTerminalJobStatus,
  type JobStore,
  type LocalJob,
} from "./job-store.js";
import type { LoopTokenStore } from "./loop-token-store.js";
import type { TelemetryEmitter } from "./telemetry-protocol.js";
import { parseApiKeySource, parseTokenUsage } from "./token-usage.js";
import { readEffectiveStatusFromState } from "../server/operations/symphony-job-snapshot.js";

export interface LoopFinalizerDeps {
  jobStore: JobStore;
  telemetry: TelemetryEmitter;
  apiAuthToken: string;
  apiBaseUrl: string;
  isProcessRunning: (pid: number) => boolean;
  /** When set, persisted loop runner token is cleared after terminal status is written. */
  loopTokenStore?: LoopTokenStore;
  /**
   * Best-effort teardown for any additional-repo worktrees persisted on the
   * job record (see `LocalJob.additionalWorktreeDirs`). Invoked only on
   * recovery/manual-repair paths — the live-exit path already cleans these
   * up in-process via its local reference.
   */
  cleanupAdditionalWorktrees?: (
    entries: readonly { dir: string; repoPath: string }[],
    loopId: string,
  ) => Promise<void>;
}

export type LoopFinalizationReason =
  | "live-exit"
  | "boot-recovery"
  | "manual-repair";

export interface LoopFinalizationOutcome {
  cloudFinalized: boolean;
  retryableFailure: boolean;
  error?: string;
}

export function parseJobWarnings(job: Pick<LocalJob, "warning">): string[] {
  if (!job.warning) {
    return [];
  }
  return job.warning
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

type ArtifactUploadDeps = Pick<
  LoopFinalizerDeps,
  "jobStore" | "apiAuthToken" | "apiBaseUrl"
>;

/** Read Claude session id from the loop workdir (matches legacy symphony-loop completion path). */
function readLoopSessionId(claudeWorkDir: string): string | undefined {
  const raw = readTextFile(path.join(claudeWorkDir, "session-id.txt"));
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/** Best-effort current branch for a git worktree (matches symphony-loop getCurrentBranchImpl). */
function getCurrentBranchFromWorktree(worktreeDir: string): string | null {
  try {
    const branch = execFileSync(
      getResolvedGitPath(),
      ["rev-parse", "--abbrev-ref", "HEAD"],
      {
        cwd: worktreeDir,
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 5_000,
      },
    ).trim();
    return branch || null;
  } catch {
    return null;
  }
}

/**
 * Session + branch fields shared by artifact upload metadata and completed-event `result`
 * so reboot replay and live exit stay compatible with the pre-finalizer desktop shape.
 */
function getCompletionCorrelationFields(
  job: LocalJob,
  command: string,
  claudeWorkDir: string,
  artifacts: Record<string, unknown>,
): { sessionId?: string; branchName?: string } {
  const sessionId = readLoopSessionId(claudeWorkDir);
  let branchName: string | undefined;

  if (command === "EXECUTE" && artifacts.executionResult) {
    const parsed = parseExecutionResultFile(artifacts.executionResult);
    if (parsed?.branchName) {
      branchName = parsed.branchName;
    }
  }

  if (!branchName && job.worktreeDir) {
    const fromGit = getCurrentBranchFromWorktree(job.worktreeDir);
    if (fromGit) {
      branchName = fromGit;
    }
  }

  return { sessionId, branchName };
}

/** Build `completed` event `result` object (legacy JobStore + desktop compatibility). */
function buildCompletedEventResult(
  job: LocalJob,
  command: string,
  claudeWorkDir: string,
  artifacts: Record<string, unknown>,
): Record<string, unknown> {
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

  const { sessionId, branchName } = getCompletionCorrelationFields(
    job,
    command,
    claudeWorkDir,
    artifacts,
  );

  const missingBranch =
    result.branchName == null ||
    (typeof result.branchName === "string" &&
      result.branchName.trim().length === 0);
  if (missingBranch && branchName) {
    result.branchName = branchName;
  }

  if (sessionId) {
    result.sessionId = sessionId;
  }

  return result;
}

function buildArtifactUploadMetadata(
  job: LocalJob,
  command: string,
  claudeWorkDir: string,
  artifacts: Record<string, unknown>,
): Record<string, unknown> {
  const { sessionId, branchName } = getCompletionCorrelationFields(
    job,
    command,
    claudeWorkDir,
    artifacts,
  );
  return {
    finishedAt: new Date().toISOString(),
    command: command.toLowerCase(),
    ...(sessionId ? { sessionId } : {}),
    ...(branchName ? { branchName } : {}),
  };
}

export async function tryUploadArtifacts(
  job: LocalJob,
  command: string,
  claudeWorkDir: string,
  worktreeDir: string | undefined,
  warnings: string[],
  deps: ArtifactUploadDeps,
): Promise<{
  artifacts: Record<string, unknown>;
  failed: boolean;
  error?: string;
}> {
  const artifacts = readArtifacts(command, claudeWorkDir, worktreeDir);
  if (job.artifactsUploadedAt) {
    return { artifacts, failed: false };
  }

  const uploadResult = await uploadArtifacts(
    deps.apiBaseUrl,
    job.loopId,
    deps.apiAuthToken,
    {
      artifacts,
      metadata: buildArtifactUploadMetadata(
        job,
        command,
        claudeWorkDir,
        artifacts,
      ),
    },
  );
  if (!uploadResult.success) {
    warnings.push("ARTIFACT_UPLOAD_FAILED");
    return { artifacts, failed: true, error: uploadResult.error };
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
): Promise<{ failed: boolean; error?: string }> {
  if (job.completedEventPostedAt) {
    return { failed: false };
  }

  const tokensUsed = parseTokenUsage(claudeWorkDir);
  const result = buildCompletedEventResult(
    job,
    command,
    claudeWorkDir,
    artifacts,
  );

  gatewayLog.info(
    "loop-finalizer",
    `loopId=${job.loopId} tokens: input=${tokensUsed.inputTokens}, output=${tokensUsed.outputTokens}, cacheCreation=${tokensUsed.cacheCreationInputTokens}, cacheRead=${tokensUsed.cacheReadInputTokens}, turns=${tokensUsed.turns}`,
  );

  const apiKeySource = parseApiKeySource(claudeWorkDir);

  const completedEvent: Record<string, unknown> = {
    type: LoopEventType.Completed,
    result,
    tokensUsed: {
      input: tokensUsed.inputTokens,
      output: tokensUsed.outputTokens,
      cacheCreationInputTokens: tokensUsed.cacheCreationInputTokens,
      cacheReadInputTokens: tokensUsed.cacheReadInputTokens,
      turns: tokensUsed.turns,
      models: tokensUsed.models,
    },
    ...(apiKeySource != null ? { apiKeySource } : {}),
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
    return { failed: true, error: eventResult.error };
  }

  const now = new Date().toISOString();
  const current = deps.jobStore.getByLoopId(job.loopId) ?? job;
  deps.jobStore.upsert({
    ...current,
    completedEventPostedAt: now,
    updatedAt: now,
  });
  return { failed: false };
}

export async function tryPostErrorEvent(
  job: LocalJob,
  claudeWorkDir: string,
  warnings: string[],
  deps: ArtifactUploadDeps,
): Promise<{ failed: boolean; error?: string }> {
  if (job.completedEventPostedAt) {
    return { failed: false };
  }

  const tokenUsage = parseTokenUsage(claudeWorkDir);
  const apiKeySource = parseApiKeySource(claudeWorkDir);
  const logTail =
    readLogTail(path.join(claudeWorkDir, "symphony-loop.log")) ?? undefined;
  const errorCode =
    job.status === "FAILED"
      ? LoopErrorCode.ProcessFailed
      : LoopErrorCode.ProcessStopped;
  const errorMessage =
    job.status === "FAILED"
      ? `Process exited with code ${job.exitCode ?? 1}`
      : `Process ended with terminal status ${job.status}`;
  const hasTokenActivity =
    tokenUsage.inputTokens > 0 ||
    tokenUsage.outputTokens > 0 ||
    tokenUsage.cacheCreationInputTokens > 0 ||
    tokenUsage.cacheReadInputTokens > 0;
  const errorEvent: Record<string, unknown> = {
    type: LoopEventType.Error,
    code: errorCode,
    message: errorMessage,
    loopId: job.loopId,
    ...(hasTokenActivity
      ? {
          tokenUsage: {
            inputTokens: tokenUsage.inputTokens,
            outputTokens: tokenUsage.outputTokens,
            cacheCreationInputTokens: tokenUsage.cacheCreationInputTokens,
            cacheReadInputTokens: tokenUsage.cacheReadInputTokens,
          },
        }
      : {}),
    ...(logTail ? { logTail } : {}),
    ...(apiKeySource != null ? { apiKeySource } : {}),
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
    return { failed: true, error: eventResult.error };
  }

  const now = new Date().toISOString();
  const current = deps.jobStore.getByLoopId(job.loopId) ?? job;
  deps.jobStore.upsert({
    ...current,
    completedEventPostedAt: now,
    updatedAt: now,
  });
  return { failed: false };
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
  const resolvedStatus: LocalJob["status"] = isSuccessStatus
    ? "COMPLETED"
    : job.status === "CANCEL_PENDING"
      ? "CANCELLED"
      : job.status;
  jobStore.upsert({
    ...current,
    status: resolvedStatus,
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
    | {
        logTail?: string;
        tokenUsage?: {
          inputTokens: number;
          outputTokens: number;
          cacheCreationInputTokens: number;
          cacheReadInputTokens: number;
        };
      }
    | undefined;
  if (reason !== "live-exit") {
    const logPath = path.join(claudeWorkDir, "symphony-loop.log");
    const logTail = readLogTail(logPath) ?? undefined;
    const parsed = parseTokenUsage(claudeWorkDir);
    const hasTokenActivity =
      parsed.inputTokens > 0 ||
      parsed.outputTokens > 0 ||
      parsed.cacheCreationInputTokens > 0 ||
      parsed.cacheReadInputTokens > 0;
    if (logTail || hasTokenActivity) {
      diagnostics = {
        logTail,
        tokenUsage: hasTokenActivity
          ? {
              inputTokens: parsed.inputTokens,
              outputTokens: parsed.outputTokens,
              cacheCreationInputTokens: parsed.cacheCreationInputTokens,
              cacheReadInputTokens: parsed.cacheReadInputTokens,
            }
          : undefined,
      };
    }
  }

  const telemetrySeverity =
    reason === "live-exit" || isSuccessStatus || job.status === "CANCELLED"
      ? "info"
      : "error";
  let telemetryMessage: string;
  if (reason === "live-exit") {
    telemetryMessage = "Job completed successfully";
  } else if (isSuccessStatus) {
    telemetryMessage = `Job finalized via ${reason}`;
  } else if (job.status === "CANCELLED") {
    telemetryMessage = `Job cancellation finalized via ${reason}`;
  } else {
    telemetryMessage = `Job finalized with status ${job.status} via ${reason}`;
  }

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
    const openQuestions = readTextFile(
      path.join(claudeWorkDir, "open-questions.md"),
    );
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
    const codeJudges = readJsonFileSync(
      path.join(claudeWorkDir, "code-judges.json"),
    );
    return {
      executionResult: executionResult ?? undefined,
      codeJudges: codeJudges ?? undefined,
    };
  }
  if (command === "DECOMPOSE") {
    const features = readJsonFileSync(
      path.join(claudeWorkDir, "features.json"),
    );
    return { features: features ?? undefined };
  }
  if (command === "EVALUATE_PRD") {
    const judges = readJsonFileSync(
      path.join(claudeWorkDir, "prd-judges.json"),
    );
    return { prdJudges: judges ?? undefined };
  }
  if (command === "EVALUATE_PLAN") {
    const judges = readJsonFileSync(
      path.join(claudeWorkDir, "plan-judges.json"),
    );
    return { planJudges: judges ?? undefined };
  }
  if (command === "EVALUATE_CODE") {
    const judges = readJsonFileSync(
      path.join(claudeWorkDir, "code-judges.json"),
    );
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
      return {
        success: false,
        error: `HTTP ${resp.status} ${resp.statusText} ${text}`,
      };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
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
      return {
        success: false,
        error: `HTTP ${resp.status} ${resp.statusText} ${text}`,
      };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Remove any persisted additional-repo worktrees for this job and clear the
 * field so subsequent finalizer retries skip the work. Safe to call with an
 * absent or missing cleanup callback — in that case the list is simply
 * cleared without filesystem side-effects.
 */
async function cleanupPersistedAdditionalWorktrees(
  job: LocalJob,
  jobStore: JobStore,
  cleanup?: LoopFinalizerDeps["cleanupAdditionalWorktrees"],
): Promise<void> {
  const entries = job.additionalWorktreeDirs;
  if (!entries || entries.length === 0) {
    return;
  }
  if (cleanup) {
    try {
      await cleanup(entries, job.loopId);
    } catch (err) {
      gatewayLog.warn(
        "loop-finalizer",
        `Additional worktree cleanup failed for loopId=${job.loopId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const current = jobStore.getByLoopId(job.loopId) ?? job;
  const { additionalWorktreeDirs: _drop, ...rest } = current;
  void _drop;
  jobStore.upsert({
    ...rest,
    updatedAt: new Date().toISOString(),
  });
}

function isRetryableFinalizationError(error?: string): boolean {
  if (!error) {
    return false;
  }
  const statusMatch = /HTTP\s+(\d{3})\b/.exec(error);
  if (!statusMatch) {
    return true;
  }
  const status = Number(statusMatch[1]);
  return status === 429 || status >= 500;
}

export async function finalizeLoopFromRuntime(
  job: LocalJob,
  reason: LoopFinalizationReason,
  deps: LoopFinalizerDeps,
): Promise<LoopFinalizationOutcome> {
  const {
    jobStore,
    telemetry,
    apiAuthToken,
    apiBaseUrl,
    isProcessRunning,
    loopTokenStore,
    cleanupAdditionalWorktrees,
  } = deps;

  if (
    job.status === "CANCEL_PENDING" &&
    job.pid != null &&
    isProcessRunning(job.pid)
  ) {
    gatewayLog.info(
      "loop-finalizer",
      `loopId=${job.loopId} cancellation pending and PID still alive; skip`,
    );
    return { cloudFinalized: false, retryableFailure: false };
  }

  const claudeWorkDir = job.claudeWorkDir;
  if (!claudeWorkDir) {
    gatewayLog.warn(
      "loop-finalizer",
      `loopId=${job.loopId} missing claudeWorkDir`,
    );
    return { cloudFinalized: false, retryableFailure: false };
  }

  // After the live-PID early return above, cancellation is confirmed: persist as terminal CANCELLED.
  const effectiveJob: LocalJob =
    job.status === "CANCEL_PENDING" ? { ...job, status: "CANCELLED" } : job;

  let resolvedJob: LocalJob = effectiveJob;
  if (reason === "boot-recovery" && effectiveJob.status === "RUNNING") {
    // Intentionally treat unresolved dead-RUNNING recovery as FAILED so cloud replay
    // emits PROCESS_FAILED for a process that died mid-run.
    let derivedStatus: LocalJob["status"] = "FAILED";
    if (effectiveJob.statePath) {
      const snapshot = await readEffectiveStatusFromState(
        effectiveJob.statePath,
      );
      if (snapshot.status !== null && isTerminalJobStatus(snapshot.status)) {
        derivedStatus = snapshot.status;
      }
    }
    const shouldDefaultExitCode =
      derivedStatus === "FAILED" ||
      derivedStatus === "STOPPED" ||
      derivedStatus === "UNKNOWN";
    resolvedJob = {
      ...effectiveJob,
      status: derivedStatus,
      exitCode: shouldDefaultExitCode
        ? (effectiveJob.exitCode ?? 1)
        : effectiveJob.exitCode,
    };
    gatewayLog.info(
      "loop-finalizer",
      `loopId=${effectiveJob.loopId} boot-recovery RUNNING resolved to ${derivedStatus} (statePath=${effectiveJob.statePath ?? "none"})`,
    );
  }

  const command = String(resolvedJob.command);
  const worktreeDir = resolvedJob.worktreeDir;
  const warnings = parseJobWarnings(resolvedJob);

  const isSuccessStatus =
    resolvedJob.status === "COMPLETED" || resolvedJob.status === "RUNNING";
  const shouldPostErrorEvent =
    resolvedJob.status === "FAILED" ||
    resolvedJob.status === "STOPPED" ||
    resolvedJob.status === "UNKNOWN";

  const artifactDeps = { jobStore, apiAuthToken, apiBaseUrl };
  const now = new Date().toISOString();
  const persistBeforeCloud = reason !== "live-exit";

  if (persistBeforeCloud) {
    persistFinalJobStatus(resolvedJob, isSuccessStatus, warnings, jobStore);
  }

  let remoteError: string | undefined;
  let retryableFailure = false;
  let cloudFinalized = false;

  if (isSuccessStatus) {
    const uploadResult = await tryUploadArtifacts(
      resolvedJob,
      command,
      claudeWorkDir,
      worktreeDir,
      warnings,
      artifactDeps,
    );
    const artifactKeys = Object.keys(uploadResult.artifacts).filter(
      (k) => uploadResult.artifacts[k] !== undefined,
    );
    if (uploadResult.failed) {
      gatewayLog.error(
        "loop-finalizer",
        `Artifact upload failed for ${command} loopId=${effectiveJob.loopId}: ${uploadResult.error}`,
      );
    } else {
      gatewayLog.info(
        "loop-finalizer",
        `Artifacts uploaded for ${command} loopId=${effectiveJob.loopId}: [${artifactKeys.join(", ")}]`,
      );
    }
    const postResult = await tryPostCompletedEvent(
      resolvedJob,
      command,
      claudeWorkDir,
      uploadResult.artifacts,
      warnings,
      artifactDeps,
    );
    if (postResult.failed) {
      gatewayLog.error(
        "loop-finalizer",
        `Completed event failed for ${command} loopId=${effectiveJob.loopId}: ${postResult.error}`,
      );
    }
    if (uploadResult.failed || postResult.failed) {
      remoteError =
        uploadResult.error ?? postResult.error ?? "Cloud finalization failed";
      retryableFailure = isRetryableFinalizationError(remoteError);
    } else {
      cloudFinalized = true;
    }
  } else if (shouldPostErrorEvent) {
    const postResult = await tryPostErrorEvent(
      resolvedJob,
      claudeWorkDir,
      warnings,
      artifactDeps,
    );
    if (postResult.failed) {
      remoteError = postResult.error ?? "Cloud finalization failed";
      retryableFailure = isRetryableFinalizationError(remoteError);
    } else {
      cloudFinalized = true;
    }
  } else {
    // No remote calls needed for statuses without cloud events.
    cloudFinalized = true;
  }

  const currentAfterCloud =
    jobStore.getByLoopId(resolvedJob.loopId) ?? resolvedJob;
  const warningText =
    warnings.length > 0
      ? warnings.map((value) => sanitizeErrorMessage(value)).join("; ")
      : undefined;
  if (cloudFinalized) {
    jobStore.upsert({
      ...currentAfterCloud,
      cloudFinalizedAt: currentAfterCloud.cloudFinalizedAt ?? now,
      lastRecoveryError: undefined,
      warning: warningText,
      updatedAt: now,
    });
  } else {
    jobStore.upsert({
      ...currentAfterCloud,
      lastRecoveryError: remoteError,
      warning: warningText,
      updatedAt: now,
    });
  }
  if (!persistBeforeCloud) {
    persistFinalJobStatus(resolvedJob, isSuccessStatus, warnings, jobStore);
  }
  emitFinalizationTelemetry(
    resolvedJob,
    reason,
    claudeWorkDir,
    isSuccessStatus,
    telemetry,
    jobStore,
  );

  if (cloudFinalized || !retryableFailure) {
    loopTokenStore?.deleteLoopToken(resolvedJob.loopId);
  }

  // Recovery/manual-repair paths own teardown of additional-repo worktrees.
  // The live-exit path already cleans these up in-process via its local
  // reference inside handleProcessCompletion; persisted cleanup here is the
  // safety net for jobs whose spawning process died before that ran.
  if (reason !== "live-exit") {
    const latest = jobStore.getByLoopId(resolvedJob.loopId) ?? resolvedJob;
    await cleanupPersistedAdditionalWorktrees(
      latest,
      jobStore,
      cleanupAdditionalWorktrees,
    );
  }

  return { cloudFinalized, retryableFailure, error: remoteError };
}

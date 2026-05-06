import { LoopCommand } from "@closedloop-ai/loops-api/commands";
import { LoopErrorCode } from "@closedloop-ai/loops-api/error-codes";
import { LoopEventType } from "@closedloop-ai/loops-api/events";
import {
  getPrimaryRepoResult,
  parseExecutionResultFile,
  type RepoExecutionResult,
} from "@closedloop-ai/loops-api/execution-result";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { readEffectiveStatusFromState } from "../server/operations/symphony-job-snapshot.js";
import {
  EVALUATE_COMMAND_ARTIFACT,
  type ExecuteFinalizationResult,
  finalizeAdditionalReposAndPersist,
  getResolvedGitPath,
  readEvaluateOutputs,
  runExecuteFinalization,
} from "../server/operations/symphony-loop.js";
import {
  assertPathAllowed,
  DirectoryNotAllowedError,
} from "../server/security.js";
import {
  IMPORTED_PLAN_MARKDOWN_FILE,
  toUploadedPlanArtifact,
} from "../shared/plan-artifact-utils.js";
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

export interface LoopFinalizerDeps {
  jobStore: JobStore;
  telemetry: TelemetryEmitter;
  apiAuthToken: string;
  apiBaseUrl: string;
  isProcessRunning: (pid: number) => boolean;
  getAllowedDirectories?: () => string[];
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

export const EXECUTE_NO_WORK_MESSAGE =
  "EXECUTE loop completed with 0 tokens -- no work was done";
export const EXECUTE_NO_WORK_LIVE_ACTIVITY =
  "Error: Loop produced no output (0 tokens)";

type ParsedTokenUsage = ReturnType<typeof parseTokenUsage>;
type TokenUsageActivity = Pick<
  ParsedTokenUsage,
  | "inputTokens"
  | "outputTokens"
  | "cacheCreationInputTokens"
  | "cacheReadInputTokens"
>;

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
  "jobStore" | "apiAuthToken" | "apiBaseUrl" | "getAllowedDirectories"
>;

function hasTerminalExecuteFinalization(
  status: LocalJob["executeFinalizationStatus"] | undefined,
): boolean {
  return (
    status === "success" ||
    status === "no-changes" ||
    status === "skipped"
  );
}

function hasTokenUsageActivity(tokenUsage: TokenUsageActivity): boolean {
  return (
    tokenUsage.inputTokens > 0 ||
    tokenUsage.outputTokens > 0 ||
    tokenUsage.cacheCreationInputTokens > 0 ||
    tokenUsage.cacheReadInputTokens > 0
  );
}

export function isExecuteNoWorkCompletion(
  command: string,
  tokenUsage: TokenUsageActivity,
): boolean {
  return command === LoopCommand.Execute && !hasTokenUsageActivity(tokenUsage);
}

function isExecuteNoWorkFailure(
  job: Pick<LocalJob, "command" | "status" | "liveActivity">,
): boolean {
  return (
    String(job.command) === LoopCommand.Execute &&
    job.status === "FAILED" &&
    job.liveActivity === EXECUTE_NO_WORK_LIVE_ACTIVITY
  );
}

function getExecuteFinalizationMetadata(
  job: LocalJob,
  command: string,
): Record<string, unknown> {
  if (command !== LoopCommand.Execute) {
    return {};
  }
  return {
    ...(job.finalizationSource
      ? { finalizationSource: job.finalizationSource }
      : {}),
    ...(job.executeFinalizationStatus
      ? { executeFinalizationStatus: job.executeFinalizationStatus }
      : {}),
    ...(job.executeFinalizationPath
      ? { executeFinalizationPath: job.executeFinalizationPath }
      : {}),
    ...(job.executeFinalizationReason
      ? { executeFinalizationReason: job.executeFinalizationReason }
      : {}),
  };
}

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

function getBranchNameFromAllowedWorktree(
  worktreeDir: string,
  getAllowedDirectories?: () => string[],
): string | undefined {
  if (getAllowedDirectories) {
    try {
      assertPathAllowed(worktreeDir, getAllowedDirectories());
    } catch (err) {
      if (err instanceof DirectoryNotAllowedError) {
        return undefined;
      }
      throw err;
    }
  }

  const branch = getCurrentBranchFromWorktree(worktreeDir);
  return branch ?? undefined;
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
  getAllowedDirectories?: () => string[],
): { sessionId?: string; branchName?: string } {
  const sessionId = readLoopSessionId(claudeWorkDir);
  let branchName: string | undefined;

  if (command === LoopCommand.Execute && artifacts.executionResult) {
    const primaryFullName = job.primaryRepoFullName ?? "";
    const parsed = parseExecutionResultFile(
      artifacts.executionResult,
      primaryFullName,
    );
    if (parsed.ok) {
      // Match buildCompletedEventResult's lookup so reboot replay and live
      // exit pick the same entry — never rely on positional ordering.
      const lookupName = primaryFullName || parsed.results[0]?.fullName || "";
      const primary = getPrimaryRepoResult(parsed.results, lookupName);
      if (primary?.status === "success" && primary.branchName) {
        branchName = primary.branchName;
      }
    }
  }

  if (!branchName && job.worktreeDir) {
    branchName = getBranchNameFromAllowedWorktree(
      job.worktreeDir,
      getAllowedDirectories,
    );
  }

  return { sessionId, branchName };
}

/** Build `completed` event `result` object (legacy JobStore + desktop compatibility). */
function buildCompletedEventResult(
  job: LocalJob,
  command: string,
  claudeWorkDir: string,
  artifacts: Record<string, unknown>,
  getAllowedDirectories?: () => string[],
): { result: Record<string, unknown>; results?: RepoExecutionResult[] } {
  const result: Record<string, unknown> = {
    exitCode: job.exitCode ?? 0,
    subtype: command.toLowerCase(),
  };
  let results: RepoExecutionResult[] | undefined;
  const setNoChangesFields = (): void => {
    result.prUrl = null;
    result.prNumber = null;
    result.has_changes = false;
  };

  if (command === LoopCommand.Execute && artifacts.executionResult) {
    const primaryFullName = job.primaryRepoFullName ?? "";
    const parsed = parseExecutionResultFile(artifacts.executionResult);
    if (!parsed.ok) {
      gatewayLog.warn(
        "execution-result-parse-failed",
        `loopId=${job.loopId} error=${parsed.error}`,
      );
      setNoChangesFields();
    } else if (parsed.schemaVersion !== 2) {
      gatewayLog.warn(
        "execution-result-unsupported-schema",
        `loopId=${job.loopId} schemaVersion=${parsed.schemaVersion}`,
      );
      setNoChangesFields();
    } else {
      const lookupName = primaryFullName || parsed.results[0]?.fullName || "";
      const primaryResult = getPrimaryRepoResult(parsed.results, lookupName);

      results = parsed.results;

      if (primaryResult === null) {
        gatewayLog.warn(
          "primary-repo-not-found-in-results",
          `loopId=${job.loopId} primaryFullName=${lookupName}`,
        );
        setNoChangesFields();
      } else if (primaryResult.status === "success") {
        result.prUrl = primaryResult.prUrl;
        result.prNumber = primaryResult.prNumber;
        result.branchName = primaryResult.branchName;
        result.has_changes = primaryResult.hasChanges;
      } else {
        setNoChangesFields();
      }
    }
  }

  const { sessionId, branchName } = getCompletionCorrelationFields(
    job,
    command,
    claudeWorkDir,
    artifacts,
    getAllowedDirectories,
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

  return {
    result: {
      ...result,
      ...getExecuteFinalizationMetadata(job, command),
    },
    ...(results ? { results } : {}),
  };
}

function buildArtifactUploadMetadata(
  job: LocalJob,
  command: string,
  claudeWorkDir: string,
  artifacts: Record<string, unknown>,
  getAllowedDirectories?: () => string[],
): Record<string, unknown> {
  const { sessionId, branchName } = getCompletionCorrelationFields(
    job,
    command,
    claudeWorkDir,
    artifacts,
    getAllowedDirectories,
  );
  return {
    finishedAt: new Date().toISOString(),
    command: command.toLowerCase(),
    ...(sessionId ? { sessionId } : {}),
    ...(branchName ? { branchName } : {}),
    ...getExecuteFinalizationMetadata(job, command),
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
        deps.getAllowedDirectories,
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
  const completedResult = buildCompletedEventResult(
    job,
    command,
    claudeWorkDir,
    artifacts,
    deps.getAllowedDirectories,
  );

  gatewayLog.info(
    "loop-finalizer",
    `loopId=${job.loopId} tokens: input=${tokensUsed.inputTokens}, output=${tokensUsed.outputTokens}, cacheCreation=${tokensUsed.cacheCreationInputTokens}, cacheRead=${tokensUsed.cacheReadInputTokens}, turns=${tokensUsed.turns}`,
  );

  const apiKeySource = parseApiKeySource(claudeWorkDir);

  const completedEvent: Record<string, unknown> = {
    type: LoopEventType.Completed,
    result: completedResult.result,
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
    ...(completedResult.results ? { results: completedResult.results } : {}),
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
  const noWorkProduced = isExecuteNoWorkFailure(job);
  const errorCode =
    noWorkProduced
      ? LoopErrorCode.NoWorkProduced
      : job.status === "FAILED"
      ? LoopErrorCode.ProcessFailed
      : LoopErrorCode.ProcessStopped;
  const errorMessage =
    noWorkProduced
      ? EXECUTE_NO_WORK_MESSAGE
      : job.status === "FAILED"
      ? `Process exited with code ${job.exitCode ?? 1}`
      : `Process ended with terminal status ${job.status}`;
  const correlationFields = getCompletionCorrelationFields(
    job,
    String(job.command),
    claudeWorkDir,
    readArtifacts(String(job.command), claudeWorkDir, job.worktreeDir),
  );
  const hasTokenActivity = hasTokenUsageActivity(tokenUsage);
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
    ...(correlationFields.sessionId
      ? { sessionId: correlationFields.sessionId }
      : {}),
    ...(correlationFields.branchName
      ? { branchName: correlationFields.branchName }
      : {}),
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
    liveActivity: job.liveActivity ?? current.liveActivity,
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
  if (command === LoopCommand.Plan || command === LoopCommand.RequestChanges) {
    const plan = toUploadedPlanArtifact(
      readJsonFileSync(path.join(claudeWorkDir, "plan.json")),
    );
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
  if (command === LoopCommand.Execute) {
    const plan =
      toUploadedPlanArtifact(readJsonFileSync(path.join(claudeWorkDir, "plan.json"))) ??
      toUploadedPlanArtifact(
        readTextFile(path.join(claudeWorkDir, IMPORTED_PLAN_MARKDOWN_FILE)),
      );
    const executionResult = readJsonFileSync(
      path.join(claudeWorkDir, "execution-result.json"),
    );
    const codeJudges = readJsonFileSync(
      path.join(claudeWorkDir, "code-judges.json"),
    );
    return {
      plan: plan ?? undefined,
      executionResult: executionResult ?? undefined,
      codeJudges: codeJudges ?? undefined,
    };
  }
  if (command === LoopCommand.Decompose) {
    const features = readJsonFileSync(
      path.join(claudeWorkDir, "features.json"),
    );
    return { features: features ?? undefined };
  }
  if (
    command === LoopCommand.EvaluatePrd ||
    command === LoopCommand.EvaluatePlan ||
    command === LoopCommand.EvaluateCode ||
    command === LoopCommand.EvaluateFeature
  ) {
    return readEvaluateOutputs(
      claudeWorkDir,
      EVALUATE_COMMAND_ARTIFACT[command],
    );
  }
  if (
    command === LoopCommand.GeneratePrd ||
    command === LoopCommand.RequestPrdChanges
  ) {
    // Both PRD commands write the (re)generated PRD to prd.md in the same
    // worktree. Live completion in handleProcessCompletion handles both via
    // the same dispatch (see symphony-loop.ts); boot recovery must mirror
    // that, otherwise a REQUEST_PRD_CHANGES loop finalized after an Electron
    // restart would silently lose the generated artifact.
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
  const { additionalWorktreeDirs: _, ...rest } = current;
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
  const getAllowedDirectories = deps.getAllowedDirectories ?? (() => []);

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

  if (
    (resolvedJob.status === "COMPLETED" || resolvedJob.status === "RUNNING") &&
    isExecuteNoWorkCompletion(command, parseTokenUsage(claudeWorkDir))
  ) {
    gatewayLog.error(
      "loop-finalizer",
      `${EXECUTE_NO_WORK_MESSAGE}, loopId=${resolvedJob.loopId}, reason=${reason}`,
    );
    resolvedJob = {
      ...resolvedJob,
      status: "FAILED",
      exitCode: 0,
      liveActivity: EXECUTE_NO_WORK_LIVE_ACTIVITY,
    };
  }

  const isSuccessStatus =
    resolvedJob.status === "COMPLETED" || resolvedJob.status === "RUNNING";
  const shouldPostErrorEvent =
    resolvedJob.status === "FAILED" ||
    resolvedJob.status === "STOPPED" ||
    resolvedJob.status === "UNKNOWN";

  const artifactDeps = {
    jobStore,
    apiAuthToken,
    apiBaseUrl,
    getAllowedDirectories,
  };
  const now = new Date().toISOString();
  const persistBeforeCloud = reason !== "live-exit";

  if (persistBeforeCloud) {
    persistFinalJobStatus(resolvedJob, isSuccessStatus, warnings, jobStore);
    resolvedJob = jobStore.getByLoopId(resolvedJob.loopId) ?? resolvedJob;
  }

  let executeFinalization: ExecuteFinalizationResult | null = null;
  if (
    command === LoopCommand.Execute &&
    isSuccessStatus &&
    !hasTerminalExecuteFinalization(resolvedJob.executeFinalizationStatus)
  ) {
    executeFinalization = await runExecuteFinalization({
      worktreeDir: resolvedJob.worktreeDir,
      claudeWorkDir,
      loopId: resolvedJob.loopId,
      artifactSlug: resolvedJob.artifactSlug,
      baseBranch: resolvedJob.baseBranch ?? "main",
      webAppOrigin: resolvedJob.webAppOrigin ?? "",
      committer: resolvedJob.committer,
      getAllowedDirectories,
      expectedMcpUrl: resolvedJob.expectedMcpUrl,
      jobStore,
      source: reason === "live-exit" ? "live-exit" : "boot-recovery",
      primaryFullName: resolvedJob.primaryRepoFullName ?? "",
    });
    if (
      executeFinalization.status === "error" &&
      !warnings.includes("GIT_PUSH_FAILED")
    ) {
      warnings.push("GIT_PUSH_FAILED");
    }
    resolvedJob = jobStore.getByLoopId(resolvedJob.loopId) ?? resolvedJob;
  }

  // Recovery path: replay multi-repo finalization for any persisted
  // additional-repo worktrees. The live-exit path runs its own copy of this
  // helper inside `handleProcessCompletion` (same idempotency check, so a
  // double invocation here is a no-op). This guards the crash window between
  // primary push/PR creation and the live block that persists the combined
  // V2 envelope: without this, side-repo commits/pushes are never replayed
  // and the cloud receives a primary-only envelope.
  if (
    command === LoopCommand.Execute &&
    isSuccessStatus &&
    reason !== "live-exit" &&
    resolvedJob.additionalWorktreeDirs &&
    resolvedJob.additionalWorktreeDirs.length > 0
  ) {
    try {
      const outcome = await finalizeAdditionalReposAndPersist({
        additionalEntries: resolvedJob.additionalWorktreeDirs,
        primaryFullName: resolvedJob.primaryRepoFullName ?? "",
        primaryBaseBranch: resolvedJob.baseBranch ?? "main",
        executeFinalization,
        claudeWorkDir,
        loopId: resolvedJob.loopId,
        apiBaseUrl,
        token: apiAuthToken,
        webAppOrigin: resolvedJob.webAppOrigin ?? "",
        getAllowedDirectories,
        artifactSlug: resolvedJob.artifactSlug,
        expectedMcpUrl: resolvedJob.expectedMcpUrl,
        committer: resolvedJob.committer,
      });
      gatewayLog.info(
        "loop-finalizer",
        `Additional-repo recovery for loopId=${resolvedJob.loopId}: ${outcome.status}`,
      );
      if (
        outcome.status === "ok" &&
        outcome.results.some((r) => r.status === "failed")
      ) {
        if (!warnings.includes("GIT_PUSH_FAILED")) {
          warnings.push("GIT_PUSH_FAILED");
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      gatewayLog.warn(
        "loop-finalizer",
        `Additional-repo recovery threw for loopId=${resolvedJob.loopId}: ${message}`,
      );
      if (!warnings.includes("GIT_PUSH_FAILED")) {
        warnings.push("GIT_PUSH_FAILED");
      }
    }
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

import { execSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readTextFile,
  sanitizeErrorMessage,
} from "../../main/diagnostics-helpers.js";
import { gatewayLog } from "../../main/gateway-logger.js";
import type { JobStore, LocalJobCommand } from "../../main/job-store.js";
import type { LoopTokenStore } from "../../main/loop-token-store.js";
import {
  finalizeLoopFromRuntime,
  type LoopFinalizerDeps,
} from "../../main/loop-finalizer.js";
import { Observability } from "../../main/observability.js";
import { parseTokenUsage } from "../../main/token-usage.js";
import type {
  OperationDispatcher,
  OperationRequestContext,
} from "../operation-dispatcher.js";
import { assertPathAllowed, DirectoryNotAllowedError } from "../security.js";
import { getShellEnv, getShellPath } from "../shell-path.js";
import { startOutputTailer } from "./output-tailer.js";
import { findPluginScript } from "./plugin-cache.js";
import { validateCommandInputs } from "@closedloop-ai/loops-api/commands";
import { LoopErrorCode } from "@closedloop-ai/loops-api/error-codes";
import { LoopEventType } from "@closedloop-ai/loops-api/events";
import type { LoopRequestBody } from "@closedloop-ai/loops-api/desktop-request";
import { parseExecutionResultFile } from "@closedloop-ai/loops-api/execution-result";
import {
  LoopArtifactFile,
  LoopArtifactType,
} from "@closedloop-ai/loops-api/artifacts";
import { validateResultBundle } from "@closedloop-ai/loops-api/bundles";
import {
  isProcessRunning,
  loopError,
  loopLog,
  tryAssertRepoAllowed,
} from "./symphony-utils.js";

// ---------------------------------------------------------------------------
// Imports from extracted modules
// ---------------------------------------------------------------------------

import type { WorktreeProvider } from "./symphony-loop-types.js";
import {
  PLAN_ARTIFACT_TYPES,
  REPO_REQUIREMENT_BY_COMMAND,
  VALID_COMMANDS,
} from "./symphony-loop-types.js";

import {
  collectFailureDiagnostics,
  detectAuthChallengeFromJsonl,
  detectSessionLimitFromJsonl,
  isAuthChallengeError,
  isSessionLimitError,
} from "./symphony-loop-errors.js";

import {
  readDecomposeOutputs,
  readEvaluateCodeOutputs,
  readEvaluatePlanOutputs,
  readEvaluatePrdOutputs,
  readExecuteOutputs,
  readGeneratePrdOutputs,
  readPlanOutputs,
  writeArtifactsForExecuteOrAmend,
  writeArtifactsForGeneratePrd,
  writeArtifactsForPlan,
  writeCodeArtifact,
  writePlanArtifact,
  writePrdArtifact,
} from "./symphony-loop-artifacts.js";

import { buildClaudePipeline } from "./symphony-loop-pipeline.js";

import {
  isCancelled,
  killProcessGracefully,
  runningLoops,
} from "./symphony-loop-process.js";

import {
  json,
  parseJsonBody,
  postLoopEvent,
  postLoopEventBounded,
  uploadArtifacts,
} from "./symphony-loop-api.js";

import {
  attemptLlmCommit,
  executeGitOperations,
  type GitOperationResult,
} from "./symphony-loop-commit.js";

import { defaultWorktreeProvider } from "./symphony-loop-worktree.js";

import {
  findLocalRepo,
  pickStableId,
  resolveLoopWorktreeDir,
  slugifyLoopId,
} from "./symphony-loop-repo.js";

// ---------------------------------------------------------------------------
// Re-exports for backward compatibility
// ---------------------------------------------------------------------------

export { readLogTail } from "../../main/diagnostics-helpers.js";

// Types
export type { WorktreeProvider } from "./symphony-loop-types.js";
export type { ExecutionResult, LoopCommitter, ContextPackAttachment, RunningLoop, RepoRequirement } from "./symphony-loop-types.js";
export {
  SUPPORTED_COMMANDS,
  VALID_COMMANDS,
  REPO_REQUIREMENT_BY_COMMAND,
  PLAN_ARTIFACT_TYPES,
  isExecutionResult,
} from "./symphony-loop-types.js";

// Errors
export {
  SESSION_LIMIT_PATTERN,
  detectSessionLimitFromJsonl,
  isSessionLimitError,
  AUTH_CHALLENGE_PATTERN,
  detectAuthChallengeFromJsonl,
  isAuthChallengeError,
  CREDENTIAL_PATTERNS,
  redactCredentials,
  collectFailureDiagnostics,
} from "./symphony-loop-errors.js";

// Artifacts
export {
  writePrdArtifact,
  writePlanArtifact,
  writeCodeArtifact,
  readEvaluatePrdOutputs,
  readEvaluatePlanOutputs,
  readEvaluateCodeOutputs,
} from "./symphony-loop-artifacts.js";

// Pipeline
export {
  resetResolvedClaudePath,
  getResolvedClaudePath,
} from "./symphony-loop-pipeline.js";

// Process
export {
  getActiveLoopPid,
  registerRecoveredLoop,
  unregisterLoop,
} from "./symphony-loop-process.js";

// Worktree
export { defaultWorktreeProvider } from "./symphony-loop-worktree.js";

// ---------------------------------------------------------------------------
// Process completion handler (async, runs after spawn)
// ---------------------------------------------------------------------------

async function handleProcessCompletion(
  exitCode: number,
  body: LoopRequestBody,
  apiBaseUrl: string,
  worktreeDir: string | null,
  claudeWorkDir: string,
  usedTempDir: boolean,
  expandedRepoPath: string | null,
  getAllowedDirectories: () => string[],
  jobStore?: JobStore,
  webAppOrigin?: string,
  commandId?: string,
  operationId?: string,
  wt: WorktreeProvider = defaultWorktreeProvider,
  loopTokenStore?: LoopTokenStore,
): Promise<void> {
  const { loopId, command, closedLoopAuthToken, committer } = body;
  // Temp-dir commands (DECOMPOSE, EVALUATE_*) need the entire temp tree removed on cleanup.
  const tempCleanupDir = usedTempDir ? (worktreeDir ?? claudeWorkDir) : null;

  loopLog(loopId, `Process exited with code ${exitCode}, command=${command}`);

  if (exitCode !== 0) {
    // Collect diagnostics (log tail + token usage) for the failure event
    const diagnostics = collectFailureDiagnostics(claudeWorkDir);
    const sessionFileForTelemetry = path.join(claudeWorkDir, "session-id.txt");
    const rawSessionId = readTextFile(sessionFileForTelemetry);
    const failureSessionId = rawSessionId ? rawSessionId.trim() : undefined;
    runningLoops.delete(loopId);
    const existingJob = jobStore?.getByLoopId(loopId);
    const wasCancelled =
      existingJob?.status === "CANCEL_PENDING" ||
      existingJob?.status === "CANCELLED";

    if (wasCancelled) {
      Observability.jobCancelled(
        commandId ?? existingJob?.commandId,
        operationId ?? existingJob?.operationId,
        loopId,
        exitCode,
        diagnostics,
        failureSessionId,
      );
      await postLoopEvent(apiBaseUrl, loopId, closedLoopAuthToken, {
        type: LoopEventType.Error,
        code: LoopErrorCode.Cancelled,
        message: "Loop cancelled",
        loopId,
        sessionId: failureSessionId,
        tokenUsage: diagnostics.tokenUsage,
        tokensByModel: diagnostics.tokensByModel,
        logTail: diagnostics.logTail,
        diagnosticsVersion: String(diagnostics.diagnosticsVersion),
      });
    } else {
      Observability.jobFailed(
        commandId ?? existingJob?.commandId,
        operationId ?? existingJob?.operationId,
        loopId,
        exitCode,
        diagnostics,
        failureSessionId,
      );
    }

    // Detect context/session limit errors (exit code 2, JSONL is_error, or
    // stderr patterns) and surface a specific error code.
    const jsonlError = detectSessionLimitFromJsonl(claudeWorkDir);
    const isContextLimit =
      exitCode === 2 ||
      jsonlError !== null ||
      (diagnostics.logTail != null && isSessionLimitError(diagnostics.logTail));

    // Detect auth/rate-limit/billing errors from JSONL or stderr.
    const jsonlAuthError = detectAuthChallengeFromJsonl(claudeWorkDir);
    const isAuthChallenge =
      !isContextLimit &&
      (jsonlAuthError !== null ||
        (diagnostics.logTail != null &&
          isAuthChallengeError(diagnostics.logTail)));

    if (!wasCancelled) {
      if (isContextLimit) {
        const limitMsg = jsonlError ?? "Context limit exceeded";
        loopError(loopId, `Context limit detected: ${limitMsg}`);
        gatewayLog.error(
          "loop-harness",
          `${command} hit context limit, loopId=${loopId}: ${limitMsg}`,
        );
        await postLoopEvent(apiBaseUrl, loopId, closedLoopAuthToken, {
          type: LoopEventType.Error,
          code: LoopErrorCode.ContextLimitExceeded,
          message: limitMsg,
          loopId,
          sessionId: failureSessionId,
          tokenUsage: diagnostics.tokenUsage,
          tokensByModel: diagnostics.tokensByModel,
          logTail: diagnostics.logTail,
          diagnosticsVersion: String(diagnostics.diagnosticsVersion),
        });
      } else if (isAuthChallenge) {
        const authMsg = jsonlAuthError ?? "Claude auth challenge detected";
        loopError(loopId, `Auth challenge detected: ${authMsg}`);
        gatewayLog.error(
          "loop-harness",
          `${command} hit auth challenge, loopId=${loopId}: ${authMsg}`,
        );
        Observability.jobAuthChallenge(
          commandId ?? existingJob?.commandId,
          operationId ?? existingJob?.operationId,
          loopId,
          exitCode,
          diagnostics,
          failureSessionId,
        );
        await postLoopEvent(apiBaseUrl, loopId, closedLoopAuthToken, {
          type: LoopEventType.Error,
          code: LoopErrorCode.AuthChallenge,
          message: authMsg,
          loopId,
          sessionId: failureSessionId,
          tokenUsage: diagnostics.tokenUsage,
          tokensByModel: diagnostics.tokensByModel,
          logTail: diagnostics.logTail,
          diagnosticsVersion: String(diagnostics.diagnosticsVersion),
        });
      } else {
        loopError(loopId, `Process failed with exit code ${exitCode}`);
        gatewayLog.error(
          "loop-harness",
          `${command} failed with exit code ${exitCode}, loopId=${loopId}`,
        );
        await postLoopEvent(apiBaseUrl, loopId, closedLoopAuthToken, {
          type: LoopEventType.Error,
          code: LoopErrorCode.ProcessFailed,
          message: `Process exited with code ${exitCode}`,
          loopId,
          sessionId: failureSessionId,
          tokenUsage: diagnostics.tokenUsage,
          tokensByModel: diagnostics.tokensByModel,
          logTail: diagnostics.logTail,
          diagnosticsVersion: String(diagnostics.diagnosticsVersion),
        });
      }
    }

    if (existingJob && jobStore) {
      const now = new Date().toISOString();
      jobStore.upsert({
        ...existingJob,
        status: wasCancelled ? "CANCELLED" : "FAILED",
        liveActivity:
          !wasCancelled && isContextLimit
            ? "Context limit exceeded"
            : !wasCancelled && isAuthChallenge
              ? `Auth challenge: ${jsonlAuthError ?? "authentication error"}`
              : undefined,
        exitCode,
        updatedAt: now,
        completedAt: now,
      });
    }
    if (tempCleanupDir) {
      fs.rm(tempCleanupDir, { recursive: true, force: true }).catch(() => {});
    } else if (command === "GENERATE_PRD" && worktreeDir && expandedRepoPath) {
      await wt.removeWorktree(worktreeDir, expandedRepoPath, loopId);
    }
    loopTokenStore?.deleteLoopToken(loopId);
    return;
  }

  // exitCode === 0 success path -- keep in runningLoops until post-processing completes
  try {
    // Read outputs per command
    gatewayLog.info(
      "loop-harness",
      `${command} succeeded (exit 0), reading artifacts for loopId=${loopId}`,
    );
    let artifacts: Record<string, unknown> = {};
    const metadata: Record<string, unknown> = {};
    const warnings: string[] = [];

    if (command === "PLAN" || command === "REQUEST_CHANGES") {
      artifacts = readPlanOutputs(claudeWorkDir);
    } else if (command === "EXECUTE") {
      artifacts = readExecuteOutputs(claudeWorkDir);

      // Git operations for EXECUTE
      if (worktreeDir) {
        const baseBranch = body.repo?.branch ?? "main";

        // Cancellation gate: skip git operations if cancelled during main process
        if (isCancelled(jobStore, loopId)) {
          const cancelJob = jobStore?.getByLoopId(loopId);
          if (cancelJob && jobStore) {
            const now = new Date().toISOString();
            jobStore.upsert({
              ...cancelJob,
              status: "CANCELLED",
              updatedAt: now,
              completedAt: now,
            });
          }
          if (tempCleanupDir) {
            fs.rm(tempCleanupDir, { recursive: true, force: true }).catch(
              () => {},
            );
          }
          loopTokenStore?.deleteLoopToken(loopId);
          return;
        }

        // Try LLM-assisted commit first; fall back to executeGitOperations if it
        // returns null.  Never call both.
        const llmResult = await attemptLlmCommit(
          worktreeDir,
          baseBranch,
          loopId,
          command,
          body.artifactSlug,
          webAppOrigin ?? "",
          committer,
          getAllowedDirectories,
          () => {
            warnings.push(
              sanitizeErrorMessage("LLM commit timed out after 30m"),
            );
          },
          jobStore,
          claudeWorkDir,
        );

        // Clean up any remaining LLM scratch files before fallback to prevent
        // them from being committed by executeGitOperations.  attemptLlmCommit
        // already cleans up on success, but these guards cover edge cases where
        // the process was killed before the cleanup ran.
        if (!llmResult) {
          try {
            unlinkSync(
              path.join(worktreeDir, LoopArtifactFile.ExecutionResult),
            );
          } catch {
            /* may not exist */
          }
          try {
            unlinkSync(path.join(worktreeDir, "pr-body.md"));
          } catch {
            /* may not exist */
          }
        }

        // Cancellation gate: skip fallback git operations if cancelled during LLM commit
        if (isCancelled(jobStore, loopId)) {
          const cancelJob = jobStore?.getByLoopId(loopId);
          if (cancelJob && jobStore) {
            const now = new Date().toISOString();
            jobStore.upsert({
              ...cancelJob,
              status: "CANCELLED",
              updatedAt: now,
              completedAt: now,
            });
          }
          if (tempCleanupDir) {
            fs.rm(tempCleanupDir, { recursive: true, force: true }).catch(
              () => {},
            );
          }
          loopTokenStore?.deleteLoopToken(loopId);
          return;
        }

        const gitShellPath = await getShellPath();
        const gitResult: GitOperationResult = llmResult
          ? { status: "success" as const, ...llmResult }
          : executeGitOperations(
              worktreeDir,
              committer,
              baseBranch,
              loopId,
              command,
              body.artifactSlug,
              webAppOrigin ?? "",
              gitShellPath,
            );

        if (gitResult.status === "success") {
          // Merge git info into execution result
          const execResult =
            (artifacts.executionResult as Record<string, unknown>) ?? {};
          execResult.pr_url = gitResult.prUrl;
          execResult.pr_number = gitResult.prNumber;
          execResult.branch_name = gitResult.branchName;
          execResult.commit_sha = gitResult.commitSha;
          execResult.has_changes = true;
          execResult.base_ref = baseBranch;
          artifacts.executionResult = execResult;
          metadata.branchName = gitResult.branchName;
          // Persist merged execute metadata for reboot-time finalization replay.
          try {
            writeFileSync(
              path.join(claudeWorkDir, LoopArtifactFile.ExecutionResult),
              JSON.stringify(execResult),
            );
          } catch (err) {
            loopLog(loopId, "Failed to persist execution-result.json:", err);
          }
        } else if (gitResult.status === "no-changes") {
          gatewayLog.info(
            "loop-harness",
            "no local changes detected, skipping PR creation, loopId=" + loopId,
          );
        } else if (gitResult.status === "error") {
          gatewayLog.warn(
            "loop-harness",
            "git operations failed: " +
              sanitizeErrorMessage(gitResult.reason) +
              ", loopId=" +
              loopId,
          );
          warnings.push("GIT_PUSH_FAILED");
        }
      }
    } else if (command === "DECOMPOSE") {
      artifacts = readDecomposeOutputs(worktreeDir ?? claudeWorkDir);
    } else if (command === "EVALUATE_PRD") {
      artifacts = readEvaluatePrdOutputs(claudeWorkDir);
    } else if (command === "EVALUATE_PLAN") {
      artifacts = readEvaluatePlanOutputs(claudeWorkDir);
    } else if (command === "EVALUATE_CODE") {
      artifacts = readEvaluateCodeOutputs(claudeWorkDir);
    } else if (command === "GENERATE_PRD") {
      artifacts = readGeneratePrdOutputs(worktreeDir ?? claudeWorkDir);
    }

    // Validate result bundle -- warn if required artifacts are missing for this command
    const artifactDir = worktreeDir ?? claudeWorkDir;
    const presentFiles = Object.values(LoopArtifactFile).filter(
      (f) =>
        existsSync(path.join(artifactDir, f)) ||
        existsSync(path.join(claudeWorkDir, f)),
    );
    const missingRequired = validateResultBundle(command, presentFiles);
    if (missingRequired.length > 0) {
      gatewayLog.warn(
        "loop-harness",
        `Missing required artifacts for ${command}: ${missingRequired.join(", ")}, loopId=${loopId}`,
      );
    }

    // Read session ID if available
    const sessionFile = path.join(claudeWorkDir, "session-id.txt");
    const sessionId = readTextFile(sessionFile);
    if (sessionId) {
      metadata.sessionId = sessionId.trim();
    }

    // JobStore-backed loops: `finalizeLoopFromRuntime` owns artifact upload + completed event.
    if (!jobStore) {
      const artifactKeys = Object.keys(artifacts);
      loopLog(loopId, "Artifact keys:", artifactKeys);
      gatewayLog.info(
        "loop-harness",
        `Uploading artifacts for ${command} loopId=${loopId}: [${artifactKeys.join(", ")}]`,
      );
      const uploadResult = await uploadArtifacts(
        apiBaseUrl,
        loopId,
        closedLoopAuthToken,
        {
          artifacts,
          metadata,
        },
      );
      if (!uploadResult.success) {
        gatewayLog.warn(
          "loop-harness",
          "Artifact upload failed: " +
            (uploadResult.error ?? "unknown error") +
            ", loopId=" +
            loopId,
        );
        warnings.push("ARTIFACT_UPLOAD_FAILED");
      }
    }

    // Parse token usage from claude output
    const {
      inputTokens,
      outputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      turns,
      models,
      tokensByModel,
    } = parseTokenUsage(claudeWorkDir);
    const tokensUsed = {
      inputTokens,
      outputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      turns,
      models,
    };
    loopLog(
      loopId,
      `Tokens used: input=${tokensUsed.inputTokens}, output=${tokensUsed.outputTokens}, cacheCreation=${tokensUsed.cacheCreationInputTokens}, cacheRead=${tokensUsed.cacheReadInputTokens}, turns=${tokensUsed.turns}`,
    );

    // Detect 0-token EXECUTE completions as failures (ghost loop)
    if (
      command === "EXECUTE" &&
      tokensUsed.inputTokens === 0 &&
      tokensUsed.outputTokens === 0 &&
      tokensUsed.cacheCreationInputTokens === 0 &&
      tokensUsed.cacheReadInputTokens === 0
    ) {
      const noWorkMsg =
        "EXECUTE loop completed with 0 tokens -- no work was done";
      loopError(loopId, noWorkMsg);
      gatewayLog.error("loop-harness", `${noWorkMsg}, loopId=${loopId}`);
      runningLoops.delete(loopId);
      await postLoopEvent(apiBaseUrl, loopId, closedLoopAuthToken, {
        type: LoopEventType.Error,
        code: LoopErrorCode.NoWorkProduced,
        message: noWorkMsg,
        loopId,
      });
      if (jobStore) {
        const existingJob = jobStore.getByLoopId(loopId);
        if (existingJob) {
          const now = new Date().toISOString();
          jobStore.upsert({
            ...existingJob,
            status: "FAILED",
            liveActivity: "Error: Loop produced no output (0 tokens)",
            exitCode: 0,
            updatedAt: now,
            completedAt: now,
          });
        }
      }
      if (tempCleanupDir) {
        fs.rm(tempCleanupDir, { recursive: true, force: true }).catch(() => {});
      }
      loopTokenStore?.deleteLoopToken(loopId);
      return;
    }

    // Cancellation gate: skip completed event if cancelled during post-processing
    if (isCancelled(jobStore, loopId)) {
      const cancelJob = jobStore?.getByLoopId(loopId);
      if (cancelJob && jobStore) {
        const now = new Date().toISOString();
        jobStore.upsert({
          ...cancelJob,
          status: "CANCELLED",
          updatedAt: now,
          completedAt: now,
        });
      }
      if (tempCleanupDir) {
        fs.rm(tempCleanupDir, { recursive: true, force: true }).catch(() => {});
      } else if (
        command === "GENERATE_PRD" &&
        worktreeDir &&
        expandedRepoPath
      ) {
        await wt.removeWorktree(worktreeDir, expandedRepoPath, loopId);
      }
      loopTokenStore?.deleteLoopToken(loopId);
      return;
    }

    if (warnings.length > 0 && jobStore) {
      const existingJob = jobStore.getByLoopId(loopId);
      if (existingJob) {
        const existingWarnings = existingJob.warning
          ? existingJob.warning
              .split(";")
              .map((value) => value.trim())
              .filter((value) => value.length > 0)
          : [];
        const mergedWarnings = [...new Set([...existingWarnings, ...warnings])];
        jobStore.upsert({
          ...existingJob,
          warning: mergedWarnings.map(sanitizeErrorMessage).join("; "),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    runningLoops.delete(loopId);
    const existingJob = jobStore?.getByLoopId(loopId);
    if (existingJob && jobStore) {
      gatewayLog.info(
        "loop-harness",
        `Finalizing ${command} via JobStore, loopId=${loopId}`,
      );
      const finalizerDeps: LoopFinalizerDeps = {
        jobStore,
        telemetry: { emit: () => {} },
        apiAuthToken: closedLoopAuthToken,
        apiBaseUrl,
        isProcessRunning,
        loopTokenStore,
      };
      const outcome = await finalizeLoopFromRuntime(
        existingJob,
        "live-exit",
        finalizerDeps,
      );
      if (!outcome.cloudFinalized) {
        gatewayLog.error(
          "loop-harness",
          `Cloud finalization failed for ${command} loopId=${loopId}: ${outcome.error ?? "unknown"}, retryable=${outcome.retryableFailure}`,
        );
      }
      const sessionId = readTextFile(
        path.join(claudeWorkDir, "session-id.txt"),
      );
      const normalizedSessionId = sessionId?.trim();
      Observability.jobCompleted(
        commandId ?? existingJob.commandId,
        operationId ?? existingJob.operationId,
        loopId,
        undefined,
        normalizedSessionId && normalizedSessionId.length > 0
          ? normalizedSessionId
          : undefined,
      );
    } else {
      // Legacy completion path: route-level behavior when no JobStore is present.
      // Upload already ran above (no jobStore branch).
      const result: Record<string, unknown> = {
        exitCode,
        subtype: command.toLowerCase(),
      };
      if (command === "EXECUTE" && artifacts.executionResult) {
        const parsed = parseExecutionResultFile(artifacts.executionResult);
        if (parsed) {
          result.prUrl = parsed.prUrl;
          result.prNumber = parsed.prNumber;
          result.branchName = parsed.branchName;
          result.has_changes = parsed.hasChanges;
        }
      }
      if (worktreeDir && !result.branchName) {
        const branch = wt.getCurrentBranch(worktreeDir);
        if (branch) {
          result.branchName = branch;
        }
      }
      const legacySessionId = sessionId?.trim();
      if (legacySessionId) {
        result.sessionId = legacySessionId;
      }

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
        tokensByModel,
        loopId,
        ...(warnings.length > 0 ? { warnings } : {}),
      };

      const eventResult = await postLoopEvent(
        apiBaseUrl,
        loopId,
        closedLoopAuthToken,
        completedEvent,
      );
      if (!eventResult.success) {
        warnings.push("EVENT_POST_FAILED");
      }

      Observability.jobCompleted(
        commandId,
        operationId,
        loopId,
        undefined,
        legacySessionId,
      );
      loopTokenStore?.deleteLoopToken(loopId);
    }

    // Clean up temp claude workdir after all reads and uploads are complete
    if (tempCleanupDir) {
      fs.rm(tempCleanupDir, { recursive: true, force: true }).catch(() => {});
    } else if (command === "GENERATE_PRD" && worktreeDir && expandedRepoPath) {
      await wt.removeWorktree(worktreeDir, expandedRepoPath, loopId);
    }
  } finally {
    runningLoops.delete(loopId);
  }
}

// ---------------------------------------------------------------------------
// Main route handler
// ---------------------------------------------------------------------------

async function handleLoopRequest(
  context: OperationRequestContext,
  getAllowedDirectories: () => string[],
  getApiOrigin?: () => string,
  jobStore?: JobStore,
  getWebAppOrigin?: () => string,
  worktreeProvider?: WorktreeProvider,
  loopTokenStore?: LoopTokenStore,
): Promise<void> {
  const wt = worktreeProvider ?? defaultWorktreeProvider;
  // Derive the callback URL from the gateway's trusted configuration.
  // body.apiBaseUrl is ignored -- the caller does not control where
  // loop events and artifact uploads are sent.
  const apiBaseUrl = getApiOrigin?.();
  if (!apiBaseUrl) {
    json(context, 503, { error: "API origin not configured" });
    return;
  }
  const webAppOrigin = getWebAppOrigin?.() ?? "";

  const rawBody = parseJsonBody(context);
  if (!rawBody) {
    json(context, 400, { error: "Invalid JSON body" });
    return;
  }

  const body = rawBody as unknown as LoopRequestBody;

  // Extract tracing headers forwarded by the cloud command executor.
  // Use typeof guards because IncomingMessage headers values are string | string[] | undefined.
  const commandId =
    typeof context.request?.headers?.["x-desktop-command-id"] === "string"
      ? context.request.headers["x-desktop-command-id"]
      : undefined;
  const operationId =
    typeof context.request?.headers?.["x-desktop-operation-id"] === "string"
      ? context.request.headers["x-desktop-operation-id"]
      : undefined;

  const repoRequirement =
    REPO_REQUIREMENT_BY_COMMAND[body.command] ?? "NOT_REQUIRED";

  if (!body.loopId || !body.command || !body.closedLoopAuthToken) {
    json(context, 400, {
      error: "Missing required fields: loopId, command, closedLoopAuthToken",
    });
    return;
  }

  if (!VALID_COMMANDS.has(body.command)) {
    json(context, 400, { error: `Invalid command: ${body.command}` });
    return;
  }

  if (
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
      body.loopId,
    )
  ) {
    json(context, 400, { error: "loopId must be a valid UUID" });
    return;
  }

  if (!Array.isArray(body.artifacts)) {
    json(context, 400, { error: "artifacts must be an array" });
    return;
  }

  // Shared input validation (prompt/artifacts requirements per command)
  const hasPrompt =
    typeof body.prompt === "string" && body.prompt.trim().length > 0;
  const hasArtifacts = body.artifacts.length > 0;
  const inputError = validateCommandInputs(
    body.command,
    hasPrompt,
    hasArtifacts,
  );
  if (inputError) {
    json(context, 400, { error: inputError });
    return;
  }

  if (body.command === "EVALUATE_PLAN") {
    const hasPrdArtifact = body.artifacts.some(
      (a) =>
        a.type === LoopArtifactType.Prd || a.type === LoopArtifactType.Feature,
    );
    const hasPlanArtifact = body.artifacts.some((a) =>
      PLAN_ARTIFACT_TYPES.includes(a.type),
    );
    if ((!hasPrdArtifact && !body.prompt) || !hasPlanArtifact) {
      json(context, 400, {
        error:
          "EVALUATE_PLAN requires a PRD artifact (or prompt) and an implementation plan artifact",
      });
      return;
    }
    if (!body.localRepoPath && !body.repo?.fullName) {
      json(context, 400, {
        error:
          "EVALUATE_PLAN requires a repository (repo.fullName or localRepoPath)",
      });
      return;
    }
  }

  if (body.command === "EVALUATE_CODE") {
    const hasPlanArtifact = body.artifacts.some((a) =>
      PLAN_ARTIFACT_TYPES.includes(a.type),
    );
    if (!hasPlanArtifact) {
      json(context, 400, {
        error: "EVALUATE_CODE requires an implementation plan artifact",
      });
      return;
    }
    if (!body.localRepoPath && !body.repo?.fullName) {
      json(context, 400, {
        error:
          "EVALUATE_CODE requires a repository (repo.fullName or localRepoPath)",
      });
      return;
    }
  }

  if (runningLoops.has(body.loopId)) {
    json(context, 409, { error: "Loop is already running on this machine" });
    return;
  }

  // Claim the loopId immediately to prevent concurrent requests from racing
  // past the has() check. Replaced with real entry after spawn succeeds.
  runningLoops.set(body.loopId, {
    pid: -1,
    child: null as unknown as ReturnType<typeof spawn>,
    stage: "running",
  });
  const requestSource =
    context.request?.headers?.["x-desktop-source"] === "cloud-socket"
      ? "relay"
      : "local";
  loopLog(
    body.loopId,
    `Received ${body.command} request, repo=${body.repo?.fullName ?? "none"}, stableId=${pickStableId(body)}, parentSessionId=${body.parentSessionId ?? "none"}`,
  );
  gatewayLog.info(
    "loop-harness",
    `${body.command} request via ${requestSource}, loopId=${body.loopId}, repo=${body.repo?.fullName ?? "none"}`,
  );

  let spawnedSuccessfully = false;
  try {
    const allowedDirs = getAllowedDirectories();
    let expandedRepoPath: string | null = null;

    if (repoRequirement !== "NOT_REQUIRED" && body.localRepoPath) {
      // localRepoPath takes precedence over repo.fullName lookup when present
      try {
        const repoResult = tryAssertRepoAllowed(
          body.localRepoPath,
          allowedDirs,
        );
        if ("error" in repoResult) {
          if (repoRequirement === "REQUIRED") {
            await postLoopEventBounded(
              apiBaseUrl,
              body.loopId,
              body.closedLoopAuthToken,
              {
                type: LoopEventType.Error,
                code: LoopErrorCode.RepoNotAllowed,
                message: "Repository path not allowed by sandbox policy",
              },
            );
            // runningLoops.delete handled by finally block
            json(context, repoResult.status, { error: repoResult.error });
            return;
          }
          loopLog(
            body.loopId,
            `Ignoring localRepoPath for ${body.command}: ${repoResult.error}`,
          );
        } else {
          expandedRepoPath = repoResult.path;
          loopLog(body.loopId, `Using localRepoPath: ${expandedRepoPath}`);
        }
      } catch (repoPathError) {
        if (repoRequirement === "REQUIRED") {
          throw repoPathError;
        }
        loopLog(
          body.loopId,
          `Ignoring localRepoPath for ${body.command} after resolution error: ${repoPathError instanceof Error ? repoPathError.message : String(repoPathError)}`,
        );
      }
    } else if (repoRequirement !== "NOT_REQUIRED" && body.repo?.fullName) {
      expandedRepoPath = findLocalRepo(body.repo.fullName, allowedDirs);
      if (expandedRepoPath) {
        try {
          assertPathAllowed(expandedRepoPath, allowedDirs);
        } catch (err) {
          if (err instanceof DirectoryNotAllowedError) {
            if (repoRequirement === "REQUIRED") {
              await postLoopEventBounded(
                apiBaseUrl,
                body.loopId,
                body.closedLoopAuthToken,
                {
                  type: LoopEventType.Error,
                  code: LoopErrorCode.RepoNotAllowed,
                  message: "Repository path not allowed by sandbox policy",
                },
              );
              // runningLoops.delete handled by finally block
              json(context, 403, { error: "Repository path not allowed" });
              return;
            }
            loopLog(
              body.loopId,
              `Ignoring repo.fullName for ${body.command}: repository path not allowed (${expandedRepoPath})`,
            );
            expandedRepoPath = null;
          } else {
            throw err;
          }
        }
      } else {
        if (repoRequirement === "REQUIRED") {
          await postLoopEventBounded(
            apiBaseUrl,
            body.loopId,
            body.closedLoopAuthToken,
            {
              type: LoopEventType.Error,
              code: LoopErrorCode.RepoNotFound,
              message: `Repository not found locally: ${body.repo.fullName}`,
            },
          );
          // runningLoops.delete handled by finally block (spawnedSuccessfully remains false)
          json(context, 404, {
            error: `Repository not found locally: ${body.repo.fullName}`,
          });
          return;
        }
        loopLog(
          body.loopId,
          `Ignoring repo.fullName for ${body.command}: not found locally (${body.repo.fullName})`,
        );
      }
    }

    let worktreeDir: string | null = null;
    let claudeWorkDir: string;
    let usedTempDir = false;

    if (body.command === "DECOMPOSE") {
      // DECOMPOSE uses a single temp dir for everything: context pack, logs, and output.
      // No repo/worktree needed -- artifacts go to .closedloop-ai/context/artifacts/
      // so Claude's prompt can reference them by relative path.
      usedTempDir = true;
      const tmpDir = path.join(
        os.tmpdir(),
        `symphony-decompose-${body.loopId.slice(0, 8)}`,
      );
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.mkdir(tmpDir, { recursive: true });
      claudeWorkDir = tmpDir;
      try {
        await writeArtifactsForGeneratePrd(
          tmpDir,
          body.artifacts,
          body.prompt ?? "Decompose the PRD into features.",
          body.repo,
        );
      } catch (artifactErr) {
        await fs.rm(tmpDir, { recursive: true, force: true });
        await postLoopEvent(apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
          type: LoopEventType.Error,
          code: LoopErrorCode.ArtifactWriteFailed,
          message:
            artifactErr instanceof Error
              ? artifactErr.message
              : String(artifactErr),
        });
        json(context, 500, { error: "Failed to write artifacts to workdir" });
        return;
      }
    } else if (
      body.command === "EVALUATE_PRD" ||
      body.command === "EVALUATE_PLAN" ||
      body.command === "EVALUATE_CODE"
    ) {
      // EVALUATE_PRD, EVALUATE_PLAN, and EVALUATE_CODE: use temp dir, no worktree needed.
      // Temp dir is intentionally exempt from assertPathAllowed.
      usedTempDir = true;
      const label = body.command.toLowerCase().replace(/_/g, "-");
      const tmpDir = path.join(
        os.tmpdir(),
        `symphony-${label}-${body.loopId.slice(0, 8)}`,
      );
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.mkdir(tmpDir, { recursive: true });
      claudeWorkDir = tmpDir;
      try {
        if (body.command === "EVALUATE_PRD") {
          await writePrdArtifact(claudeWorkDir, body.artifacts, body.prompt);
        } else if (body.command === "EVALUATE_PLAN") {
          await writePlanArtifact(claudeWorkDir, body.artifacts, body.prompt);
        } else if (body.command === "EVALUATE_CODE") {
          await writeCodeArtifact(claudeWorkDir, body.artifacts);
        }
      } catch (artifactErr) {
        await fs.rm(claudeWorkDir, { recursive: true, force: true });
        await postLoopEvent(apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
          type: LoopEventType.Error,
          code: LoopErrorCode.ArtifactWriteFailed,
          message:
            artifactErr instanceof Error
              ? artifactErr.message
              : String(artifactErr),
        });
        json(context, 500, { error: "Failed to write artifacts to workdir" });
        return;
      }
    } else if (repoRequirement === "REQUIRED" && !expandedRepoPath) {
      json(context, 400, {
        error:
          "Repository required for PLAN, EXECUTE, REQUEST_CHANGES, and GENERATE_PRD commands",
      });
      return;
    } else if (
      body.command === "PLAN" ||
      body.command === "EXECUTE" ||
      body.command === "REQUEST_CHANGES"
    ) {
      // expandedRepoPath is guaranteed non-null here: the repoRequirement === "REQUIRED"
      // guard above already returned 400 when it was missing.
      const repoPath = expandedRepoPath!;

      // Worktree keyed by artifact slug (e.g., symphony/PLAN-5).
      // PLAN always creates fresh; EXECUTE/REQUEST_CHANGES reuse.
      // Sanitize slug the same way we sanitize loopId to prevent path traversal.
      const sanitizedSlug = body.artifactSlug
        ? slugifyLoopId(body.artifactSlug)
        : null;
      const worktreeKey = sanitizedSlug ?? pickStableId(body);
      const branchName = sanitizedSlug
        ? `symphony/${sanitizedSlug}`
        : `symphony/loop-${pickStableId(body)}`;

      worktreeDir = resolveLoopWorktreeDir(repoPath, worktreeKey);

      if (body.command === "PLAN") {
        // PLAN always starts fresh -- remove stale worktree if it exists.
        // PLAN has requiresParent: false, so it must not inherit prior state.
        const staleWorktree = wt.findWorktreeForBranch(repoPath, branchName);
        if (staleWorktree) {
          loopLog(
            body.loopId,
            `Removing stale worktree for fresh PLAN: ${staleWorktree}`,
          );
          await wt.removeWorktree(staleWorktree, repoPath, body.loopId);
        }
        await wt.ensureWorktree(
          repoPath,
          worktreeDir,
          branchName,
          body.repo?.branch ?? "main",
          body.loopId,
        );
        loopLog(
          body.loopId,
          `Created fresh worktree for PLAN: ${worktreeDir} (branch: ${branchName})`,
        );
      } else {
        // EXECUTE/REQUEST_CHANGES: reuse existing worktree.
        // Try artifact slug first, then parentLoopId fallback, then create new.
        const existingWorktree = wt.findWorktreeForBranch(repoPath, branchName);
        if (existingWorktree) {
          worktreeDir = existingWorktree;
          loopLog(
            body.loopId,
            `Reusing worktree via artifact slug: ${worktreeDir} (branch: ${branchName})`,
          );
        } else if (body.parentLoopId) {
          // Fallback: try parent's loopId-based branch (pre-slug deployments or missing slug)
          const parentBranch = `symphony/loop-${slugifyLoopId(body.parentLoopId)}`;
          const parentWorktree = wt.findWorktreeForBranch(
            repoPath,
            parentBranch,
          );
          if (parentWorktree) {
            worktreeDir = parentWorktree;
            loopLog(
              body.loopId,
              `Reusing worktree via parentLoopId fallback: ${worktreeDir} (branch: ${parentBranch})`,
            );
          }
        }
        if (!worktreeDir || !existsSync(worktreeDir)) {
          // No existing worktree found -- create new
          worktreeDir = resolveLoopWorktreeDir(repoPath, worktreeKey);
          await wt.ensureWorktree(
            repoPath,
            worktreeDir,
            branchName,
            body.repo?.branch ?? "main",
            body.loopId,
          );
          loopLog(
            body.loopId,
            `Created new worktree: ${worktreeDir} (branch: ${branchName})`,
          );
        }
      }

      try {
        assertPathAllowed(worktreeDir, allowedDirs);
      } catch (e) {
        if (e instanceof DirectoryNotAllowedError) {
          json(context, 403, {
            error: `Worktree path not allowed: ${worktreeDir}`,
          });
          return;
        }
        throw e;
      }
      claudeWorkDir = path.join(worktreeDir, ".closedloop-ai", "work");
      await fs.mkdir(claudeWorkDir, { recursive: true });

      if (body.command === "PLAN") {
        await writeArtifactsForPlan(
          claudeWorkDir,
          body.artifacts,
          body.prompt,
          body.userContext,
          body.attachments,
        );
      } else if (body.command === "EXECUTE") {
        await writeArtifactsForExecuteOrAmend(
          claudeWorkDir,
          body.artifacts,
          undefined,
          body.attachments,
        );
      } else {
        // REQUEST_CHANGES
        await writeArtifactsForExecuteOrAmend(
          claudeWorkDir,
          body.artifacts,
          body.prompt,
          body.attachments,
        );
      }
    } else if (body.command === "GENERATE_PRD") {
      // expandedRepoPath is guaranteed non-null here: the repoRequirement === "REQUIRED"
      // guard above already returned 400 when it was missing.
      const repoPath = expandedRepoPath!;

      // Use a dedicated branch namespace to avoid collisions with PLAN/EXECUTE worktrees.
      // GENERATE_PRD always starts fresh -- it must not inherit a prior PLAN worktree.
      const sanitizedSlug = body.artifactSlug
        ? slugifyLoopId(body.artifactSlug)
        : null;
      const worktreeKey = sanitizedSlug ?? pickStableId(body);
      const branchName = sanitizedSlug
        ? `symphony/generate-prd-${sanitizedSlug}`
        : `symphony/generate-prd-${pickStableId(body)}`;

      worktreeDir = resolveLoopWorktreeDir(
        repoPath,
        `generate-prd-${worktreeKey}`,
      );

      // Always start fresh: remove any stale worktree for this branch before creation.
      const staleWorktree = wt.findWorktreeForBranch(repoPath, branchName);
      if (staleWorktree) {
        loopLog(
          body.loopId,
          `Removing stale worktree for fresh GENERATE_PRD: ${staleWorktree}`,
        );
        await wt.removeWorktree(staleWorktree, repoPath, body.loopId);
      }

      await wt.ensureWorktree(
        repoPath,
        worktreeDir,
        branchName,
        body.repo?.branch ?? "main",
        body.loopId,
      );
      loopLog(
        body.loopId,
        `Created worktree for GENERATE_PRD: ${worktreeDir} (branch: ${branchName})`,
      );

      try {
        assertPathAllowed(worktreeDir, allowedDirs);
      } catch (e) {
        if (e instanceof DirectoryNotAllowedError) {
          await wt.removeWorktree(worktreeDir, repoPath, body.loopId);
          json(context, 403, {
            error: `Worktree path not allowed: ${worktreeDir}`,
          });
          return;
        }
        throw e;
      }

      // claudeWorkDir is a separate operational dir inside the worktree (same pattern as PLAN/EXECUTE).
      // Spawn uses cwd: worktreeDir so Claude writes prd.md to the repo root.
      // Logs, PID, and prompt file go to claudeWorkDir, not the repo root.
      claudeWorkDir = path.join(worktreeDir, ".closedloop-ai", "work");
      await fs.mkdir(claudeWorkDir, { recursive: true });
      await writeArtifactsForGeneratePrd(
        worktreeDir,
        body.artifacts,
        body.prompt!,
        body.repo,
      );
    } else {
      json(context, 400, { error: `Unknown command: ${body.command}` });
      return;
    }

    /** Clean up temporary resources on early-return error paths. */
    const tempRootDir = usedTempDir ? (worktreeDir ?? claudeWorkDir) : null;
    const cleanupOnError = async (): Promise<void> => {
      if (tempRootDir) {
        await fs
          .rm(tempRootDir, { recursive: true, force: true })
          .catch(() => {});
      }
      if (body.command === "GENERATE_PRD" && worktreeDir && expandedRepoPath) {
        await wt.removeWorktree(worktreeDir, expandedRepoPath, body.loopId);
      }
    };

    // Pre-flight: verify required binary exists BEFORE posting 'started' event.
    // PLAN and EXECUTE use run-loop.sh; REQUEST_CHANGES and DECOMPOSE use claude CLI directly.
    const usesRunLoop = body.command === "PLAN" || body.command === "EXECUTE";
    const usesClaude =
      body.command === "REQUEST_CHANGES" ||
      body.command === "DECOMPOSE" ||
      body.command === "EVALUATE_PRD" ||
      body.command === "GENERATE_PRD" ||
      body.command === "EVALUATE_PLAN" ||
      body.command === "EVALUATE_CODE";
    let scriptPath: string | null = null;

    if (usesClaude) {
      try {
        const whichEnv = { ...process.env, PATH: await getShellPath() };
        execSync("which claude", {
          stdio: "pipe",
          timeout: 5000,
          env: whichEnv,
        });
      } catch {
        await postLoopEvent(apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
          type: LoopEventType.Error,
          code: LoopErrorCode.BinaryNotFound,
          message: "claude CLI not found in PATH",
        });
        Observability.preflightBinaryNotFound(
          commandId,
          operationId,
          body.loopId,
        );
        await cleanupOnError();
        json(context, 500, { error: "claude CLI not found in PATH" });
        return;
      }
    } else if (usesRunLoop) {
      scriptPath = findPluginScript("code", "run-loop.sh");
      if (!scriptPath) {
        await postLoopEvent(apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
          type: LoopEventType.Error,
          code: LoopErrorCode.ScriptNotFound,
          message: "run-loop.sh not found in plugin cache",
        });
        Observability.preflightScriptNotFound(
          commandId,
          operationId,
          body.loopId,
        );
        json(context, 500, { error: "run-loop.sh not found in plugin cache" });
        return;
      }
    }

    try {
      if (loopTokenStore) {
        loopTokenStore.setLoopToken(body.loopId, body.closedLoopAuthToken);
      }
    } catch (err) {
      loopLog(
        body.loopId,
        `Failed to persist loop auth token: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Post "started" event -- only after confirming we can proceed
    loopLog(body.loopId, "Posting started event...");
    await postLoopEvent(apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
      type: LoopEventType.Started,
    });

    // Spawn process
    const logFile = path.join(claudeWorkDir, "symphony-loop.log");
    let logFd: number;
    try {
      logFd = openSync(logFile, "a");
    } catch (logErr) {
      const msg = logErr instanceof Error ? logErr.message : String(logErr);
      await postLoopEvent(apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
        type: LoopEventType.Error,
        code: LoopErrorCode.SpawnFailed,
        message: `Cannot open log file: ${msg}`,
      });
      Observability.preflightSpawnFailed(
        commandId,
        operationId,
        body.loopId,
        `Cannot open log file: ${msg}`,
      );
      await cleanupOnError();
      json(context, 500, { error: `Cannot open log file: ${msg}` });
      return;
    }
    let child: ReturnType<typeof spawn>;

    try {
      const spawnEnv: Record<string, string> = await getShellEnv({
        CLOSEDLOOP_WORKDIR: claudeWorkDir,
      });

      // Shared claude CLI args for commands that run claude directly.
      // REQUEST_CHANGES omits "-" (stdin) because it passes the prompt as a CLI argument.
      const baseClaudeArgs: string[] = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--allowedTools",
        "Bash,Glob,Grep,Read,Write,Edit,Task,Skill,SlashCommand,TodoWrite",
        "--max-turns",
        "200",
      ];
      const stdinClaudeArgs = ["-p", "-", ...baseClaudeArgs.slice(1)];

      if (body.command === "DECOMPOSE") {
        // DECOMPOSE: prompt piped via stdin, cwd is the temp dir which contains
        // .closedloop-ai/context/artifacts/ so Claude can find them by relative path.
        const promptFile = path.join(claudeWorkDir, "decompose-prompt.txt");
        await fs.writeFile(
          promptFile,
          body.prompt ?? "Decompose the PRD into features.",
        );

        const pipeline = buildClaudePipeline(
          stdinClaudeArgs,
          claudeWorkDir,
          promptFile,
        );
        child = spawn(pipeline.cmd, pipeline.args, {
          cwd: claudeWorkDir,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: spawnEnv,
        });
        child.unref();
      } else if (body.command === "EVALUATE_PRD") {
        // REPO_PATH only when a target repo is linked (expandedRepoPath).
        let evaluatePrdPrompt = `Activate judges:run-judges skill --artifact-type prd --workdir ${claudeWorkDir}.\n`;
        if (expandedRepoPath) {
          evaluatePrdPrompt += `REPO_PATH=${expandedRepoPath} (search here for relevant code).\n`;
        }
        const promptFile = path.join(claudeWorkDir, "evaluate-prd-prompt.txt");
        await fs.writeFile(promptFile, evaluatePrdPrompt);

        const pipeline = buildClaudePipeline(
          stdinClaudeArgs,
          claudeWorkDir,
          promptFile,
        );
        child = spawn(pipeline.cmd, pipeline.args, {
          cwd: claudeWorkDir,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: spawnEnv,
        });
        child.unref();
      } else if (
        body.command === "EVALUATE_PLAN" ||
        body.command === "EVALUATE_CODE"
      ) {
        // EVALUATE_PLAN and EVALUATE_CODE share identical spawn logic,
        // differing only in the artifact type passed to run-judges.
        // Unlike EVALUATE_PRD (where REPO_PATH is optional--only added when a repo is linked),
        // plan and code judges need the implementation tree, so the request must resolve to
        // a local repo and expandedRepoPath is always set on this path.
        const artifactType = body.command === "EVALUATE_PLAN" ? "plan" : "code";
        const label = `evaluate-${artifactType}`;
        const prompt =
          `Activate judges:run-judges skill --artifact-type ${artifactType} --workdir ${claudeWorkDir}.\n` +
          `REPO_PATH=${expandedRepoPath}\n`;
        const promptFile = path.join(claudeWorkDir, `${label}-prompt.txt`);
        await fs.writeFile(promptFile, prompt);

        const pipeline = buildClaudePipeline(
          stdinClaudeArgs,
          claudeWorkDir,
          promptFile,
        );
        child = spawn(pipeline.cmd, pipeline.args, {
          cwd: claudeWorkDir,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: spawnEnv,
        });
        child.unref();
      } else if (body.command === "REQUEST_CHANGES") {
        // REQUEST_CHANGES: use claude directly with /code:amend-plan.
        // Must use -p (headless mode) so --allowedTools grants full permission
        // without prompting. Pipes through stream_formatter.py for readable logs.
        const claudeArgs = [...baseClaudeArgs];

        // Resume from parent session if available (matches harness --resume)
        if (body.parentSessionId) {
          claudeArgs.push("--resume", body.parentSessionId);
        }

        // Build /code:amend-plan invocation matching harness
        const promptFile = path.join(claudeWorkDir, "prompt.md");
        let amendPrompt =
          "Please amend the plan based on the requested changes.";
        if (existsSync(promptFile)) {
          amendPrompt = readFileSync(promptFile, "utf-8");
        }
        // Sanitize prompt matching harness's prepare-message step
        const sanitized = amendPrompt
          .replaceAll(/[\n\r]+/g, " ")
          .replaceAll(/\s{2,}/g, " ")
          .replaceAll(/"/g, '\\"');
        claudeArgs.push(
          `/code:amend-plan --workdir ${claudeWorkDir} --message "${sanitized}"`,
        );

        const pipeline = buildClaudePipeline(claudeArgs, claudeWorkDir);
        child = spawn(pipeline.cmd, pipeline.args, {
          cwd: worktreeDir!,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: spawnEnv,
        });
        child.unref();
      } else if (body.command === "GENERATE_PRD") {
        const promptFile = path.join(claudeWorkDir, "generate-prd-prompt.txt");
        await fs.writeFile(promptFile, body.prompt!);

        const pipeline = buildClaudePipeline(
          stdinClaudeArgs,
          claudeWorkDir,
          promptFile,
        );
        child = spawn(pipeline.cmd, pipeline.args, {
          cwd: worktreeDir!,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: spawnEnv,
        });
        child.unref();
      } else {
        // PLAN, EXECUTE: spawn run-loop.sh
        // Build args matching ECS harness-agent's buildRunLoopArgs():
        // 1. workdir (positional)
        // 2. --max-iterations (EXECUTE=150, PLAN=50)
        // 3. --prd (when prd.md exists)
        const scriptArgs = [claudeWorkDir];

        const maxIterations = body.command === "EXECUTE" ? "150" : "50";
        scriptArgs.push("--max-iterations", maxIterations);

        const prdPath = path.join(claudeWorkDir, LoopArtifactFile.Prd);
        if (existsSync(prdPath)) {
          scriptArgs.push("--prd", prdPath);
        }

        child = spawn(scriptPath!, scriptArgs, {
          cwd: worktreeDir!,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: spawnEnv,
        });
        child.unref();
      }
    } catch (spawnErr) {
      closeSync(logFd);
      const msg =
        spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
      await postLoopEvent(apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
        type: LoopEventType.Error,
        code: LoopErrorCode.SpawnFailed,
        message: msg,
      });
      Observability.preflightSpawnFailed(
        commandId,
        operationId,
        body.loopId,
        msg,
      );
      await cleanupOnError();
      json(context, 500, { error: `Failed to spawn process: ${msg}` });
      return;
    }
    closeSync(logFd);

    const tailerJsonlPath = path.join(claudeWorkDir, "claude-output.jsonl");
    const jsonlPreSpawnOffset = existsSync(tailerJsonlPath)
      ? statSync(tailerJsonlPath).size
      : 0;

    // Guard against double-firing: both 'error' and 'exit' can emit.
    let completionHandled = false;
    let stopTailer: { stop: () => void; flush: () => Promise<void> } = {
      stop: () => {},
      flush: () => Promise.resolve(),
    };
    const onceComplete = async (code: number): Promise<void> => {
      if (completionHandled) return;
      completionHandled = true;
      loopLog(body.loopId, `onceComplete fired, code=${code}`);
      try {
        await stopTailer.flush();
      } catch (err) {
        loopError(body.loopId, "Tailer flush error:", err);
      }
      handleProcessCompletion(
        code,
        body,
        apiBaseUrl,
        worktreeDir,
        claudeWorkDir,
        usedTempDir,
        expandedRepoPath,
        getAllowedDirectories,
        jobStore,
        webAppOrigin,
        commandId,
        operationId,
        wt,
        loopTokenStore,
      ).catch((err) => {
        loopError(body.loopId, "Completion handler error:", err);
        gatewayLog.error(
          "loop-harness",
          `Completion handler error for loopId=${body.loopId}: ${err instanceof Error ? err.message : err}`,
        );
      });
    };

    // Prevent unhandled 'error' events (e.g. ENOENT if binary vanishes
    // between pre-flight check and spawn) from crashing Electron.
    child.on("error", (err) => {
      loopError(body.loopId, "Spawn error:", err.message);
      void onceComplete(1);
    });

    // Use 'exit' instead of 'close' -- with detached processes using
    // inherited file descriptors (not pipes), 'close' may never fire
    // because there are no Node.js streams to track closure of.
    child.on("exit", (code) => {
      loopLog(body.loopId, `Process exit event, code=${code}`);
      void onceComplete(code ?? 1);
    });

    const pid = child.pid ?? null;

    if (!pid) {
      // error handler above will fire asynchronously -- respond immediately
      json(context, 500, { error: "Failed to spawn process" });
      return;
    }

    // Replace sentinel with real entry -- storing `child` prevents GC of the
    // ChildProcess handle which would silently drop the exit listener.
    runningLoops.set(body.loopId, { pid, child, stage: "running" });
    stopTailer = startOutputTailer(
      tailerJsonlPath,
      apiBaseUrl,
      body.loopId,
      body.closedLoopAuthToken,
      jsonlPreSpawnOffset,
      jobStore
        ? (offset) => {
            // Persist replay-safe JSONL offset (framed + POST ok when output is emitted).
            const job = jobStore.getByLoopId(body.loopId);
            if (job) {
              jobStore.upsert({ ...job, lastObservedJsonlOffset: offset });
            }
          }
        : undefined,
    );
    spawnedSuccessfully = true;
    loopLog(body.loopId, `Spawned pid=${pid}, worktree=${worktreeDir}`);
    gatewayLog.debug(
      "loop-harness",
      `Spawned ${body.command} pid=${pid}, loopId=${body.loopId}, worktree=${worktreeDir}`,
    );

    // Bind runtime details to an existing LocalJob or create a new one for this loop
    if (jobStore) {
      const existing = jobStore.getByLoopId(body.loopId);
      const now = new Date().toISOString();
      const logPath = path.join(claudeWorkDir, "symphony-loop.log");
      const jsonlPath = path.join(claudeWorkDir, "claude-output.jsonl");
      const statePath = path.join(claudeWorkDir, "state.json");
      const command = body.command as LocalJobCommand;
      jobStore.upsert({
        id: body.loopId,
        kind: "SYMPHONY_LOOP",
        loopId: body.loopId,
        command,
        ...existing,
        ...(commandId ? { commandId } : {}),
        ...(operationId ? { operationId } : {}),
        worktreeDir: worktreeDir ?? undefined,
        claudeWorkDir,
        logPath,
        jsonlPath,
        statePath,
        pid,
        status: "RUNNING",
        updatedAt: now,
        startedAt: existing?.startedAt ?? now,
        apiBaseUrl,
        lastObservedJsonlOffset:
          existing?.lastObservedJsonlOffset ?? jsonlPreSpawnOffset,
      });
    }

    Observability.jobStarted(commandId, operationId, body.loopId, pid);

    // Write PID file (safe to await now -- close handler is already registered)
    await fs.writeFile(path.join(claudeWorkDir, "process.pid"), String(pid));

    json(context, 200, {
      success: true,
      loopId: body.loopId,
      pid,
      worktreePath: worktreeDir,
    });
  } finally {
    // Clean up sentinel and persisted token if we never reached a successful spawn
    if (!spawnedSuccessfully) {
      runningLoops.delete(body.loopId);
      loopTokenStore?.deleteLoopToken(body.loopId);
    }
  }
}

// ---------------------------------------------------------------------------
// Kill handler
// ---------------------------------------------------------------------------

async function handleLoopKill(
  context: OperationRequestContext,
  jobStore?: JobStore,
): Promise<void> {
  const rawBody = parseJsonBody(context);
  if (!rawBody) {
    json(context, 400, { error: "Invalid JSON body" });
    return;
  }

  const loopId = typeof rawBody.loopId === "string" ? rawBody.loopId : null;
  if (!loopId) {
    json(context, 400, { error: "loopId is required" });
    return;
  }

  const entry = runningLoops.get(loopId);
  if (entry === undefined) {
    // Post-restart fallback: check JobStore for a live PID
    if (jobStore) {
      const job = jobStore.getByLoopId(loopId);
      if (job?.pid != null) {
        let processWasAlive = false;
        try {
          process.kill(job.pid, 0); // alive?
          processWasAlive = true;
          await killProcessGracefully(job.pid, 3000);
        } catch {
          /* already dead */
        }
        jobStore.upsert({
          ...job,
          status: processWasAlive ? "CANCEL_PENDING" : "CANCELLED",
          updatedAt: new Date().toISOString(),
          ...(!processWasAlive
            ? { completedAt: new Date().toISOString() }
            : {}),
        });
        json(context, 200, {
          success: true,
          message: "Loop process terminated (restart fallback)",
        });
        return;
      }
    }
    json(context, 404, { error: "No running process found for this loop" });
    return;
  }
  if (entry.pid <= 0) {
    json(context, 409, { error: "Loop is still initializing, retry shortly" });
    return;
  }

  // Set CANCEL_PENDING before sending signals so handleProcessCompletion
  // sees the cancellation intent when the exit event fires.
  if (jobStore) {
    const existingJob = jobStore.getByLoopId(loopId);
    if (existingJob) {
      jobStore.upsert({
        ...existingJob,
        status: "CANCEL_PENDING",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  await killProcessGracefully(entry.pid, 3000);

  runningLoops.delete(loopId);
  json(context, 200, { success: true, message: "Loop process terminated" });
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerSymphonyLoopRoutes(
  dispatcher: OperationDispatcher,
  getAllowedDirectories: () => string[],
  getApiOrigin?: () => string,
  jobStore?: JobStore,
  getWebAppOrigin?: () => string,
  worktreeProvider?: WorktreeProvider,
  loopTokenStore?: LoopTokenStore,
): void {
  dispatcher.register(
    "POST",
    "/api/engineer/symphony/loop",
    async (context) => {
      await handleLoopRequest(
        context,
        getAllowedDirectories,
        getApiOrigin,
        jobStore,
        getWebAppOrigin,
        worktreeProvider,
        loopTokenStore,
      );
    },
  );

  dispatcher.register(
    "POST",
    "/api/engineer/symphony/loop/kill",
    async (context) => {
      await handleLoopKill(context, jobStore);
    },
  );
}

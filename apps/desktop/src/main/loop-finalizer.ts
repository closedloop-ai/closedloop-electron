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

export interface LoopFinalizerDeps {
  jobStore: JobStore;
  telemetry: TelemetryEmitter;
  assertPathAllowed: (targetPath: string, allowedDirectories: string[]) => void;
  apiAuthToken: string;
  apiBaseUrl: string;
  isProcessRunning: (pid: number) => boolean;
}

export type LoopFinalizationReason =
  | "live-exit"
  | "boot-recovery"
  | "manual-repair";

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
  const { jobStore, telemetry, apiAuthToken, apiBaseUrl, isProcessRunning } = deps;

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
  const warnings: string[] = job.warning
    ? job.warning
        .split(";")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [];

  let artifacts: Record<string, unknown> = {};

  if (!job.artifactsUploadedAt) {
    artifacts = readArtifacts(command, claudeWorkDir, worktreeDir);
    const uploadResult = await uploadArtifacts(apiBaseUrl, job.loopId, apiAuthToken, {
      artifacts,
      metadata: {
        finishedAt: new Date().toISOString(),
        command: command.toLowerCase(),
      },
    });
    if (!uploadResult.success) {
      warnings.push("ARTIFACT_UPLOAD_FAILED");
    } else {
      const now = new Date().toISOString();
      const current = jobStore.getByLoopId(job.loopId) ?? job;
      jobStore.upsert({
        ...current,
        artifactsUploadedAt: now,
        updatedAt: now,
      });
    }
  } else {
    artifacts = readArtifacts(command, claudeWorkDir, worktreeDir);
  }

  if (!job.completedEventPostedAt) {
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
      apiBaseUrl,
      job.loopId,
      apiAuthToken,
      completedEvent,
    );
    if (!eventResult.success) {
      warnings.push("EVENT_POST_FAILED");
    } else {
      const now = new Date().toISOString();
      const current = jobStore.getByLoopId(job.loopId) ?? job;
      jobStore.upsert({
        ...current,
        completedEventPostedAt: now,
        updatedAt: now,
      });
    }
  }

  if (!job.finalStatusPersistedAt) {
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
          ? warnings.map((value) => sanitizeErrorMessage(value)).join("; ")
          : undefined,
    });
  }

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

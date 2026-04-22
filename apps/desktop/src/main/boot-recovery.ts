import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { startOutputTailer } from "../server/operations/output-tailer.js";
import {
  cleanupAdditionalWorktreesWithDefaultProvider,
  registerRecoveredLoop,
  unregisterLoop,
} from "../server/operations/symphony-loop.js";
import { isProcessRunning } from "../server/operations/symphony-utils.js";
import { gatewayLog } from "./gateway-logger.js";
import { isTerminalJobStatus, type JobStore, type LocalJob } from "./job-store.js";
import type { LoopTokenStore } from "./loop-token-store.js";
import {
  finalizeLoopFromRuntime,
  type LoopFinalizerDeps,
} from "./loop-finalizer.js";
import type { TelemetryEmitter } from "./telemetry-protocol.js";

export interface BootRecoveryDeps {
  jobStore: JobStore;
  telemetry: TelemetryEmitter;
  getApiKey: () => string | null;
  getApiOrigin: () => string;
  loopTokenStore: LoopTokenStore;
}

interface LiveJobHandle {
  loopId: string;
  tailer?: { stop: () => void; flush: () => Promise<void> };
  watcherId: ReturnType<typeof setInterval>;
}

const DEFAULT_WATCHER_POLL_MS = 3000;
const MAX_RECOVERY_ATTEMPTS = 3;

export class BootRecoveryService {
  private readonly deps: BootRecoveryDeps;
  private liveHandles: LiveJobHandle[] = [];
  private readonly backgroundTasks = new Set<Promise<void>>();
  private deadJobFinalizationTask: Promise<void> | null = null;
  // Prevents new recovery work and stops background watchers after shutdown begins.
  private disposed = false;

  constructor(deps: BootRecoveryDeps) {
    this.deps = deps;
  }

  async run(deadJobs: LocalJob[]): Promise<void> {
    if (this.disposed) return;
    await this.finalizeDeadJobs(deadJobs);
    await this.reattachLiveJobs();
    this.sweepOrphanedTokens();
  }

  async reattachLiveJobs(): Promise<void> {
    if (this.disposed) return;

    const { jobStore, getApiKey, getApiOrigin } = this.deps;
    const apiKey = getApiKey();
    const apiBaseUrl = getApiOrigin();
    const liveJobs = jobStore
      .listRunning()
      .filter((job) => job.pid != null && isProcessRunning(job.pid));

    if (liveJobs.length === 0) {
      return;
    }
    if (!apiKey || !apiBaseUrl) {
      gatewayLog.warn(
        "boot-recovery",
        `Skipping ${liveJobs.length} live loop reattach(es): missing API config`,
      );
      return;
    }

    for (const job of liveJobs) {
      await this.reattachLiveJob(job, apiBaseUrl);
    }
  }

  startDeadJobFinalization(deadJobs: LocalJob[]): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    if (this.deadJobFinalizationTask) {
      return this.deadJobFinalizationTask;
    }
    const task = this.trackBackgroundTask(this.finalizeDeadJobs(deadJobs));
    this.deadJobFinalizationTask = task;
    void task.finally(() => {
      if (this.deadJobFinalizationTask === task) {
        this.deadJobFinalizationTask = null;
      }
    });
    return task;
  }

  async quiesce(timeoutMs: number): Promise<void> {
    const pending = [...this.backgroundTasks];
    if (pending.length === 0) {
      return;
    }
    await Promise.race([
      Promise.allSettled(pending).then(() => undefined),
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
  }

  private async finalizeDeadJobs(deadJobs: LocalJob[]): Promise<void> {
    if (this.disposed) return;

    const { jobStore, telemetry, getApiKey, getApiOrigin, loopTokenStore } = this.deps;
    const apiKey = getApiKey();
    const apiBaseUrl = getApiOrigin();
    const recoveryCandidates = this.buildRecoveryCandidates(deadJobs);
    if (recoveryCandidates.length > 0 && (!apiKey || !apiBaseUrl)) {
      gatewayLog.warn(
        "boot-recovery",
        `Skipping ${recoveryCandidates.length} dead loop finalization(s): missing API config`,
      );
      return;
    }
    if (!apiKey || !apiBaseUrl) {
      return;
    }
    for (const candidate of recoveryCandidates) {
      if (this.disposed) {
        return;
      }
      const job = jobStore.getByLoopId(candidate.loopId) ?? candidate;
      const attempts = job.recoveryAttempts ?? 0;
      if (attempts >= MAX_RECOVERY_ATTEMPTS) {
        this.markRecoveryGiveUp(job, `Exceeded retry cap (${MAX_RECOVERY_ATTEMPTS})`);
        loopTokenStore.deleteLoopToken(job.loopId);
        continue;
      }
      try {
        const authToken = loopTokenStore.getLoopToken(job.loopId);
        if (!authToken) {
          gatewayLog.warn(
            "boot-recovery",
            `Skipping dead loop finalization: missing loop token for loopId=${job.loopId} (phase=dead-finalization)`,
          );
          continue;
        }
        gatewayLog.info(
          "boot-recovery",
          `Token source for loopId=${job.loopId}: LOOP_TOKEN_STORE`,
        );
        jobStore.upsert({
          ...job,
          recoveryAttempts: attempts + 1,
          updatedAt: new Date().toISOString(),
        });
        const outcome = await finalizeLoopFromRuntime(job, "boot-recovery", {
          jobStore,
          telemetry,
          apiAuthToken: authToken,
          apiBaseUrl,
          isProcessRunning,
          loopTokenStore,
          cleanupAdditionalWorktrees:
            cleanupAdditionalWorktreesWithDefaultProvider,
        });
        if (!outcome.cloudFinalized && outcome.retryableFailure) {
          const latest = jobStore.getByLoopId(job.loopId);
          if ((latest?.recoveryAttempts ?? 0) >= MAX_RECOVERY_ATTEMPTS) {
            this.markRecoveryGiveUp(job, `Exceeded retry cap (${MAX_RECOVERY_ATTEMPTS})`);
            loopTokenStore.deleteLoopToken(job.loopId);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.markRecoveryFailure(job, message);
        gatewayLog.warn(
          "boot-recovery",
          `Dead loop finalization failed for loopId=${job.loopId}: ${message}`,
        );
      }
    }
  }

  private buildRecoveryCandidates(deadJobs: LocalJob[]): LocalJob[] {
    const { jobStore } = this.deps;
    const byLoopId = new Map<string, LocalJob>();
    for (const job of deadJobs) {
      byLoopId.set(job.loopId, job);
    }
    for (const terminalJob of jobStore.listCompleted()) {
      if (terminalJob.finalStatusPersistedAt && !terminalJob.cloudFinalizedAt) {
        byLoopId.set(terminalJob.loopId, terminalJob);
      }
    }
    return [...byLoopId.values()].filter((job) => {
      if (job.cloudFinalizedAt) {
        return false;
      }
      return (job.recoveryAttempts ?? 0) < MAX_RECOVERY_ATTEMPTS;
    });
  }

  private markRecoveryFailure(job: LocalJob, error: string): void {
    const { jobStore } = this.deps;
    const current = jobStore.getByLoopId(job.loopId) ?? job;
    jobStore.upsert({
      ...current,
      lastRecoveryError: error,
      updatedAt: new Date().toISOString(),
    });
  }

  private markRecoveryGiveUp(job: LocalJob, error: string): void {
    const { jobStore } = this.deps;
    const current = jobStore.getByLoopId(job.loopId) ?? job;
    jobStore.upsert({
      ...current,
      lastRecoveryError: error,
      updatedAt: new Date().toISOString(),
      cloudFinalizedAt: current.cloudFinalizedAt ?? new Date().toISOString(),
    });
  }

  private async reattachLiveJob(job: LocalJob, apiBaseUrl: string): Promise<void> {
    const { jobStore } = this.deps;
    const { loopId, pid } = job;
    if (pid == null) return;

    const effectiveApiBaseUrl = job.apiBaseUrl ?? apiBaseUrl;
    const loopAuthToken = this.deps.loopTokenStore.getLoopToken(loopId);
    if (!loopAuthToken) {
      gatewayLog.warn(
        "boot-recovery",
        `Skipping live loop reattach: missing loop token for loopId=${loopId} (phase=live-reattach)`,
      );
      return;
    }
    gatewayLog.info(
      "boot-recovery",
      `Token source for loopId=${loopId}: LOOP_TOKEN_STORE`,
    );

    // TOCTOU guard: process was alive when liveJobs was built, but may have exited since.
    if (!isProcessRunning(pid)) {
      this.finalizeRecoveredJob(loopId, loopAuthToken, effectiveApiBaseUrl, undefined);
      return;
    }

    registerRecoveredLoop(loopId, pid);

    gatewayLog.info(
      "boot-recovery",
      `Reattaching live loop loopId=${loopId} pid=${pid}`,
    );

    let tailer: LiveJobHandle["tailer"] | undefined;
    if (job.jsonlPath) {
      gatewayLog.info(
        "boot-recovery",
        `Starting output tailer for loopId=${loopId} jsonlPath=${job.jsonlPath} offset=${job.lastObservedJsonlOffset ?? 0} api=${effectiveApiBaseUrl}`,
      );
      // `onOffset` is replay-safe (framed + delivered when a POST is required); see output-tailer.
      tailer = startOutputTailer(
        job.jsonlPath,
        effectiveApiBaseUrl,
        loopId,
        loopAuthToken,
        job.lastObservedJsonlOffset ?? 0,
        (offset) => {
          const current = jobStore.getByLoopId(loopId);
          if (current) {
            jobStore.upsert({ ...current, lastObservedJsonlOffset: offset });
          }
        },
      );
    } else {
      gatewayLog.warn(
        "boot-recovery",
        `Cannot start output tailer for loopId=${loopId}: no jsonlPath (claudeWorkDir=${job.claudeWorkDir ?? "none"})`,
      );
    }

    const watcherPollMs =
      Number(process.env.CLOSEDLOOP_WATCHER_POLL_MS) || DEFAULT_WATCHER_POLL_MS;
    const watcherId = setInterval(() => {
      if (this.disposed) {
        clearInterval(watcherId);
        return;
      }
      if (!isProcessRunning(pid)) {
        clearInterval(watcherId);
        this.liveHandles = this.liveHandles.filter((value) => value.loopId !== loopId);
        unregisterLoop(loopId);
        this.finalizeRecoveredJob(loopId, loopAuthToken, effectiveApiBaseUrl, tailer);
      }
    }, watcherPollMs);

    this.liveHandles.push({ loopId, tailer, watcherId });
  }

  private finalizeRecoveredJob(
    loopId: string,
    loopAuthToken: string,
    apiBaseUrl: string,
    tailer: LiveJobHandle["tailer"] | undefined,
  ): void {
    const { jobStore, telemetry, loopTokenStore } = this.deps;

    const run = async () => {
      if (this.disposed) {
        return;
      }
      if (tailer) {
        try {
          await tailer.flush();
        } catch {
          // best effort
        }
      }
      if (this.disposed) {
        return;
      }

      const job = jobStore.getByLoopId(loopId);
      if (!job) {
        gatewayLog.warn("boot-recovery", `loopId=${loopId} missing from JobStore`);
        return;
      }

      const finalizerDeps: LoopFinalizerDeps = {
        jobStore,
        telemetry,
        apiAuthToken: loopAuthToken,
        apiBaseUrl,
        isProcessRunning,
        loopTokenStore,
        cleanupAdditionalWorktrees:
          cleanupAdditionalWorktreesWithDefaultProvider,
      };

      try {
        await finalizeLoopFromRuntime(job, "boot-recovery", finalizerDeps);
        gatewayLog.info(
          "boot-recovery",
          `Finalized recovered loop loopId=${loopId}`,
        );
      } catch (err) {
        gatewayLog.warn(
          "boot-recovery",
          `Recovered loop finalization failed for loopId=${loopId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    void this.trackBackgroundTask(run()).catch(() => {});
  }

  dispose(): void {
    this.disposed = true;
    for (const handle of this.liveHandles) {
      clearInterval(handle.watcherId);
      handle.tailer?.stop();
    }
    this.liveHandles = [];
  }

  private sweepOrphanedTokens(): void {
    const { jobStore, loopTokenStore } = this.deps;
    const tokenLoopIds = loopTokenStore.listLoopIds();
    for (const loopId of tokenLoopIds) {
      const job = jobStore.getByLoopId(loopId);
      if (!job || (isTerminalJobStatus(job.status) && job.cloudFinalizedAt)) {
        loopTokenStore.deleteLoopToken(loopId);
      }
    }
  }

  private trackBackgroundTask(task: Promise<void>): Promise<void> {
    this.backgroundTasks.add(task);
    void task.finally(() => {
      this.backgroundTasks.delete(task);
    });
    return task;
  }
}

/** Glob pattern that matches loop worktree directory names: `<repoName>-loop-<stableId>`. */
const LOOP_WORKTREE_PATTERN = /-loop-[a-z0-9-]+$/;

/**
 * Resolve the main (non-worktree) git repository root from a worktree path.
 * Returns null when the path is not a valid git worktree or the command fails.
 */
function resolveMainRepoFromWorktree(worktreeDir: string, gitBin: string): string | null {
  try {
    const gitCommonDir = execFileSync(
      gitBin,
      ["rev-parse", "--git-common-dir"],
      {
        cwd: worktreeDir,
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 5_000,
      },
    ).trim();

    if (!gitCommonDir) {
      return null;
    }

    // --git-common-dir returns the .git dir of the main worktree.
    // The main repo root is one level up from it (unless the repo has a non-standard layout).
    const resolved = path.isAbsolute(gitCommonDir)
      ? gitCommonDir
      : path.resolve(worktreeDir, gitCommonDir);
    return path.dirname(resolved);
  } catch {
    return null;
  }
}

/**
 * Determine whether `worktreeDir` is registered in git's worktree metadata for
 * `mainRepoPath` (i.e. listed by `git worktree list --porcelain`).
 */
function isWorktreeRegistered(mainRepoPath: string, worktreeDir: string, gitBin: string): boolean {
  try {
    const output = execFileSync(
      gitBin,
      ["worktree", "list", "--porcelain"],
      {
        cwd: mainRepoPath,
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 10_000,
      },
    );

    const normalized = path.normalize(worktreeDir);
    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        const listedPath = path.normalize(line.slice("worktree ".length).trim());
        if (listedPath === normalized) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Collect all worktree paths recorded in the JobStore (both active and terminal jobs).
 * Returns a Set of normalised absolute paths for fast membership testing.
 */
function collectKnownWorktreeDirs(jobStore: JobStore): Set<string> {
  const known = new Set<string>();
  const collect = (job: LocalJob) => {
    if (job.worktreeDir) {
      known.add(path.normalize(job.worktreeDir));
    }
    for (const entry of job.additionalWorktreeDirs ?? []) {
      known.add(path.normalize(entry.dir));
    }
  };

  for (const job of jobStore.listRunning()) {
    collect(job);
  }
  for (const job of jobStore.listCompleted()) {
    collect(job);
  }
  return known;
}

/**
 * Startup orphan sweep: remove git worktrees under `worktreeParentDir` that
 * match the loop-worktree naming pattern (`<name>-loop-<stableId>`) but are
 * no longer referenced by any job in the JobStore.
 *
 * Uses `git worktree list --porcelain` to enumerate registered worktrees and
 * `git worktree remove --force <path>` for removal, so git's own metadata
 * stays consistent.  All failures are best-effort — the sweep never throws.
 */
export async function sweepOrphanLoopWorktrees(
  worktreeParentDir: string,
  jobStore: JobStore,
  gitBin: string,
): Promise<void> {
  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await fs.readdir(worktreeParentDir, { withFileTypes: true });
  } catch {
    // Parent dir may not exist yet (fresh install) — nothing to sweep.
    return;
  }

  const knownWorktrees = collectKnownWorktreeDirs(jobStore);

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (!LOOP_WORKTREE_PATTERN.test(entry.name)) {
      continue;
    }

    const worktreeDir = path.join(worktreeParentDir, entry.name);
    const normalizedDir = path.normalize(worktreeDir);

    // Skip any worktree that is still referenced by a known job.
    if (knownWorktrees.has(normalizedDir)) {
      continue;
    }

    // Resolve the main repo this worktree belongs to via git metadata.
    const mainRepo = resolveMainRepoFromWorktree(worktreeDir, gitBin);
    if (!mainRepo) {
      // Not a valid git worktree — skip to avoid touching unrelated directories.
      continue;
    }

    // Double-check it's actually registered in git's worktree list.
    if (!isWorktreeRegistered(mainRepo, worktreeDir, gitBin)) {
      continue;
    }

    try {
      execFileSync(
        gitBin,
        ["worktree", "remove", "--force", worktreeDir],
        {
          cwd: mainRepo,
          stdio: "pipe",
          timeout: 15_000,
        },
      );
      gatewayLog.info(
        "boot-recovery",
        `Orphan sweep: removed loop worktree ${worktreeDir}`,
      );
    } catch (err) {
      gatewayLog.warn(
        "boot-recovery",
        `Orphan sweep: failed to remove ${worktreeDir}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

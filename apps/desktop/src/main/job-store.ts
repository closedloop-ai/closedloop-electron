import Store from "electron-store";

export type LocalJobStatus =
  | "QUEUED"
  | "STARTING"
  | "RUNNING"
  | "AWAITING_USER"
  | "STOPPED"
  | "CANCEL_PENDING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "UNKNOWN";

export type LocalJobKind = "SYMPHONY_LOOP";

export type LocalJobCommand = "PLAN" | "EXECUTE" | "REQUEST_CHANGES" | "DECOMPOSE" | "GENERATE_PRD";

/** Loop terminal error codes (SSOT for type, values, and runtime sets). */
export enum LoopErrorCode {
  CONTEXT_LIMIT_EXCEEDED = "CONTEXT_LIMIT_EXCEEDED",
  AUTH_CHALLENGE = "AUTH_CHALLENGE",
  PROCESS_FAILED = "PROCESS_FAILED",
  PROCESS_STOPPED = "PROCESS_STOPPED",
}

export type TaskProgress = {
  pending: number;
  completed: number;
  total: number;
};

export type LocalJob = {
  id: string;
  kind: LocalJobKind;
  loopId: string;
  commandId?: string;
  operationId?: string;
  command: LocalJobCommand;
  ticketId?: string;
  artifactId?: string;
  artifactSlug?: string;
  issueId?: string;
  repoPath?: string;
  localRepoPath?: string;
  worktreeDir?: string;
  claudeWorkDir?: string;
  logPath?: string;
  jsonlPath?: string;
  statePath?: string;
  pid?: number;
  status: LocalJobStatus;
  phase?: string;
  liveActivity?: string;
  currentTaskId?: string;
  taskProgress?: TaskProgress;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  warning?: string;
  exitCode?: number | null;
  lastErrorCode?: LoopErrorCode;
  /**
   * Replay-safe byte offset into `jsonlPath` (claude-output.jsonl).
   * Updated by the output tailer only after newline-delimited bytes are committed:
   * either summarized with no cloud `output` event, or after a successful (2xx) POST.
   */
  lastObservedJsonlOffset?: number;
  artifactsUploadedAt?: string;
  completedEventPostedAt?: string;
  finalStatusPersistedAt?: string;
  /** Set once cloud-side finalization is fully persisted. */
  cloudFinalizedAt?: string;
  /** Number of boot/live finalization attempts after local terminal persistence. */
  recoveryAttempts?: number;
  /** Last cloud finalization error for diagnostics and retry decisions. */
  lastRecoveryError?: string;
  apiBaseUrl?: string;
};

const TERMINAL_STATUSES: ReadonlySet<LocalJobStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "STOPPED",
  "UNKNOWN",
]);

export function isTerminalJobStatus(status: LocalJobStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

const MAX_TERMINAL_JOBS = 100;

type JobStoreSchema = {
  activeJobs: LocalJob[];
  terminalJobs: LocalJob[];
};

export interface JobStoreOptions {
  cwd?: string;
  name?: string;
}

export class JobStore {
  private readonly store: Store<JobStoreSchema>;
  private activeJobs: Map<string, LocalJob>;
  private terminalJobs: LocalJob[];

  constructor(options?: JobStoreOptions) {
    this.store = new Store<JobStoreSchema>({
      name: options?.name ?? "desktop-job-store",
      cwd: options?.cwd,
      defaults: {
        activeJobs: [],
        terminalJobs: [],
      },
    });

    const persistedActive = this.store.get("activeJobs", []);
    const persistedTerminal = this.store.get("terminalJobs", []);

    this.activeJobs = new Map(
      (Array.isArray(persistedActive) ? persistedActive : []).map((j) => [j.id, j])
    );
    this.terminalJobs = Array.isArray(persistedTerminal)
      ? persistedTerminal.slice(0, MAX_TERMINAL_JOBS)
      : [];
  }

  upsert(job: LocalJob): LocalJob {
    const isTerminal = TERMINAL_STATUSES.has(job.status);

    if (isTerminal) {
      // Move from active to terminal
      this.activeJobs.delete(job.id);

      // Prepend to terminal list, deduplicate, cap
      this.terminalJobs = [
        job,
        ...this.terminalJobs.filter((j) => j.id !== job.id),
      ].slice(0, MAX_TERMINAL_JOBS);
    } else {
      this.activeJobs.set(job.id, job);
    }

    this.persist();
    return job;
  }

  getById(id: string): LocalJob | undefined {
    return this.activeJobs.get(id) ?? this.terminalJobs.find((j) => j.id === id);
  }

  getByLoopId(loopId: string): LocalJob | undefined {
    for (const job of this.activeJobs.values()) {
      if (job.loopId === loopId) {
        return job;
      }
    }
    return this.terminalJobs.find((j) => j.loopId === loopId);
  }

  listRunning(): LocalJob[] {
    return [...this.activeJobs.values()];
  }

  listCompleted(): LocalJob[] {
    return [...this.terminalJobs];
  }

  /**
   * Reconcile persisted active jobs on startup.
   * Calls `checkLiveness(job)` for each active job to determine final state.
   * Returns jobs that were reconciled into terminal states.
   */
  reconcile(checkLiveness: (job: LocalJob) => LocalJob): LocalJob[] {
    const reconciled: LocalJob[] = [];

    for (const job of [...this.activeJobs.values()]) {
      const updated = checkLiveness(job);
      if (TERMINAL_STATUSES.has(updated.status)) {
        this.upsert(updated);
        reconciled.push(updated);
      } else if (updated !== job) {
        this.upsert(updated);
      }
    }

    return reconciled;
  }

  private persist(): void {
    this.store.set("activeJobs", [...this.activeJobs.values()]);
    this.store.set("terminalJobs", this.terminalJobs);
  }
}

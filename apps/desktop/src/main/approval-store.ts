import { createHash, randomUUID } from "node:crypto";
import Store from "electron-store";
import type { RiskTier } from "../shared/contracts.js";

export type ApprovalDecision = "approved" | "denied" | "always_allow" | "expired";

export type PendingApproval = {
  id: string;
  createdAt: string;
  operationId: string;
  riskTier: Exclude<RiskTier, "auto">;
  method: string;
  path: string;
  scopePath?: string;
  location: string;
  reason: string;
  fingerprint: string;
};

type ApprovalStoreSchema = {
  pending: PendingApproval[];
};

export interface ApprovalStoreOptions {
  onChange?: (pendingCount: number) => void;
  onNewApproval?: (approval: PendingApproval) => void;
}

export class ApprovalStore {
  private readonly pendingById = new Map<string, PendingApproval>();
  private readonly pendingByFingerprint = new Map<string, string>();
  private readonly waitersByApprovalId = new Map<string, Set<(decision: ApprovalDecision) => void>>();
  private readonly store: Store<ApprovalStoreSchema>;
  private readonly onChange?: (pendingCount: number) => void;
  private readonly onNewApproval?: (approval: PendingApproval) => void;

  constructor(options?: ApprovalStoreOptions) {
    this.onChange = options?.onChange;
    this.onNewApproval = options?.onNewApproval;
    this.store = new Store<ApprovalStoreSchema>({
      name: "desktop-approvals",
      defaults: {
        pending: []
      }
    });

    const persistedPending = this.store.get("pending", []);
    if (Array.isArray(persistedPending)) {
      for (const entry of persistedPending) {
        if (!entry || typeof entry.id !== "string" || typeof entry.fingerprint !== "string") {
          continue;
        }
        this.pendingById.set(entry.id, entry);
        this.pendingByFingerprint.set(entry.fingerprint, entry.id);
      }
    }

    this.notifyChange();
  }

  static fingerprint(method: string, path: string, body: string): string {
    return createHash("sha256")
      .update(`${method.toUpperCase()}\n${path}\n${body}`)
      .digest("hex");
  }

  enqueue(input: {
    operationId: string;
    riskTier: Exclude<RiskTier, "auto">;
    method: string;
    path: string;
    body: string;
    scopePath?: string;
    location: string;
    reason: string;
  }): PendingApproval {
    const fingerprint = ApprovalStore.fingerprint(input.method, input.path, input.body);
    const existingId = this.pendingByFingerprint.get(fingerprint);
    if (existingId) {
      const existing = this.pendingById.get(existingId);
      if (existing) {
        return existing;
      }
    }

    const pending: PendingApproval = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      operationId: input.operationId,
      riskTier: input.riskTier,
      method: input.method.toUpperCase(),
      path: input.path,
      scopePath: input.scopePath,
      location: input.location,
      reason: input.reason,
      fingerprint
    };
    this.pendingById.set(pending.id, pending);
    this.pendingByFingerprint.set(fingerprint, pending.id);
    this.persist();
    this.onNewApproval?.(pending);
    return pending;
  }

  waitForDecision(approvalId: string, timeoutMs: number): Promise<ApprovalDecision> {
    if (!this.pendingById.has(approvalId)) {
      return Promise.resolve("denied");
    }

    return new Promise<ApprovalDecision>((resolve) => {
      let waiters = this.waitersByApprovalId.get(approvalId);
      if (!waiters) {
        waiters = new Set();
        this.waitersByApprovalId.set(approvalId, waiters);
      }

      const resolveOnce = (decision: ApprovalDecision): void => {
        clearTimeout(timeoutHandle);
        resolve(decision);
      };

      waiters.add(resolveOnce);

      const timeoutHandle = setTimeout(() => {
        this.resolveAndRemove(approvalId, "expired");
      }, timeoutMs);
    });
  }

  listPending(): PendingApproval[] {
    return [...this.pendingById.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getPendingById(id: string): PendingApproval | null {
    return this.pendingById.get(id) ?? null;
  }

  countPending(): number {
    return this.pendingById.size;
  }

  approve(id: string): PendingApproval | null {
    return this.resolveAndRemove(id, "approved");
  }

  deny(id: string): PendingApproval | null {
    return this.resolveAndRemove(id, "denied");
  }

  alwaysAllow(id: string): PendingApproval | null {
    return this.resolveAndRemove(id, "always_allow");
  }

  clear(): void {
    const ids = [...this.pendingById.keys()];
    for (const id of ids) {
      this.resolveAndRemove(id, "denied");
    }
    this.persist();
  }

  private resolveAndRemove(id: string, decision: ApprovalDecision): PendingApproval | null {
    const pending = this.pendingById.get(id);
    if (!pending) {
      return null;
    }

    this.pendingById.delete(id);
    this.pendingByFingerprint.delete(pending.fingerprint);

    const waiters = this.waitersByApprovalId.get(id);
    if (waiters) {
      for (const waiter of waiters) {
        waiter(decision);
      }
      this.waitersByApprovalId.delete(id);
    }

    this.persist();
    return pending;
  }

  private persist(): void {
    this.store.set("pending", [...this.pendingById.values()]);
    this.notifyChange();
  }

  private notifyChange(): void {
    this.onChange?.(this.pendingById.size);
  }
}

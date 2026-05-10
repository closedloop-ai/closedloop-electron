import type {
  CommandKeyReconciliationResult,
  RegisteredOrganizationCommandKey,
} from "./authorized-command-key-store.js";
import type { OrganizationCommandPublicKey } from "./authorized-public-keys-client.js";

export const COMMAND_KEY_RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000;

type CommandKeyReconcilerOptions = {
  hasApiKey: () => boolean;
  fetchOrganizationKeys: () => Promise<OrganizationCommandPublicKey[]>;
  reconcileOrganizationKeys: (
    registeredKeys: Iterable<RegisteredOrganizationCommandKey>,
  ) => CommandKeyReconciliationResult;
  notifyPendingKeys?: (
    organizationKeys: OrganizationCommandPublicKey[],
  ) => Promise<void> | void;
  onChanged: () => void;
  log: (level: "debug" | "info" | "warn", message: string) => void;
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

/**
 * Reconciles org-approved browser command keys against the API's `/public-keys`
 * registry. Missing API credentials and fetch failures are non-destructive.
 */
export class CommandKeyReconciler {
  private readonly options: CommandKeyReconcilerOptions;
  private readonly intervalMs: number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(options: CommandKeyReconcilerOptions) {
    this.options = options;
    this.intervalMs =
      options.intervalMs ?? COMMAND_KEY_RECONCILIATION_INTERVAL_MS;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = this.setIntervalFn(() => {
      void this.reconcileNow("periodic");
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    this.clearIntervalFn(this.timer);
    this.timer = null;
  }

  async reconcileNow(reason: "hello_ack" | "periodic" | "manual"): Promise<void> {
    if (this.inFlight) {
      this.options.log(
        "debug",
        `Skipping command key reconciliation (${reason}): already running`,
      );
      return;
    }
    if (!this.options.hasApiKey()) {
      this.options.log(
        "warn",
        `Skipping command key reconciliation (${reason}): missing API key`,
      );
      return;
    }

    this.inFlight = true;
    try {
      const organizationKeys = await this.options.fetchOrganizationKeys();
      const reconciliation = this.options.reconcileOrganizationKeys(
        organizationKeys.map((key) => ({
          fingerprint: key.fingerprint,
          ...(key.id ? { sourceUserPublicKeyId: key.id } : {}),
        })),
      );
      const changed =
        reconciliation.removed.length > 0 || reconciliation.promoted.length > 0;
      if (changed) {
        this.options.log(
          "info",
          `Reconciled browser command keys (${reason}): removed ${reconciliation.removed.length} stale org key(s), promoted ${reconciliation.promoted.length} legacy org key(s)`,
        );
        this.options.onChanged();
      }
      await this.notifyPendingKeys(organizationKeys, reason);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "failed to fetch public keys";
      this.options.log(
        "warn",
        `Skipping command key reconciliation (${reason}): ${message}`,
      );
    } finally {
      this.inFlight = false;
    }
  }

  private async notifyPendingKeys(
    organizationKeys: OrganizationCommandPublicKey[],
    reason: "hello_ack" | "periodic" | "manual",
  ): Promise<void> {
    if (!this.options.notifyPendingKeys) {
      return;
    }
    try {
      await this.options.notifyPendingKeys(organizationKeys);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "failed to notify pending command keys";
      this.options.log(
        "warn",
        `Skipping pending command key notification (${reason}): ${message}`,
      );
    }
  }
}

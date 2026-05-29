import Store from "electron-store";
import {
  getElectronSafeStorage,
  type SafeStorageLike,
} from "./electron-safe-storage.js";
import {
  fetchAnthropicCostReport,
  AnthropicAuthError,
  AnthropicNetworkError,
  AnthropicRateLimitedError,
  AnthropicMalformedResponseError,
} from "./anthropic-admin-client.js";

/**
 * Encrypted persistence for the Anthropic organization Admin Key. The key
 * authorizes the Anthropic Cost API (FEA-1435 nightly reconciliation).
 *
 * Pattern mirrors {@link ApiKeyStore}/{@link LoopTokenStore}: electron-store +
 * safeStorage. The Admin Key is extremely sensitive — it MUST NEVER appear in
 * logs, error messages, telemetry, or thrown error strings. Validation errors
 * surface only generic codes (`401`, `403`, `network`, `rate_limited`,
 * `malformed`).
 *
 * Provenance metadata captured on first set / last successful validation:
 * - `setAt`: when the key was first persisted.
 * - `lastValidatedAt`: ISO timestamp of the most recent successful validation
 *   round-trip against the Anthropic Cost API.
 */

export type AnthropicAdminKeyStatus = {
  set: boolean;
  setAt?: string;
  lastValidatedAt?: string;
};

export type AnthropicValidationOutcome =
  | { ok: true; status: AnthropicAdminKeyStatus }
  | { ok: false; error: "401" | "403" | "network" | "rate_limited" | "malformed" | "safe_storage_unavailable" };

type AnthropicAdminKeySchema = {
  encryptedAnthropicAdminKey?: string;
  anthropicAdminKeySetAt?: string;
  anthropicAdminKeyLastValidatedAt?: string;
  [key: string]: string | undefined;
};

export interface AnthropicAdminKeyStoreOptions {
  cwd?: string;
  name?: string;
  /** Test-only override; production omits this. */
  safeStorage?: SafeStorageLike;
  /** Test-only override of the cost-report fetcher; production omits this. */
  fetchCostReport?: typeof fetchAnthropicCostReport;
  /** Test-only override of the clock; production omits this. */
  now?: () => string;
}

export class AnthropicAdminKeyStore {
  private readonly store: Store<AnthropicAdminKeySchema>;
  private readonly safe: SafeStorageLike;
  private readonly fetchCostReport: typeof fetchAnthropicCostReport;
  private readonly now: () => string;

  constructor(options?: AnthropicAdminKeyStoreOptions) {
    this.safe = getElectronSafeStorage(
      options?.safeStorage,
      "AnthropicAdminKeyStore",
    );
    this.store = new Store<AnthropicAdminKeySchema>({
      name: options?.name ?? "desktop-anthropic-admin-key",
      cwd: options?.cwd,
    });
    this.fetchCostReport = options?.fetchCostReport ?? fetchAnthropicCostReport;
    this.now = options?.now ?? (() => new Date().toISOString());
  }

  /** Returns the plaintext Admin Key or null when unset/undecryptable. */
  get(): string | null {
    const encrypted = this.store.get("encryptedAnthropicAdminKey");
    if (!encrypted) {
      return null;
    }
    if (!this.safe.isEncryptionAvailable()) {
      return null;
    }
    try {
      return this.safe.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
      return null;
    }
  }

  /**
   * Persists the Admin Key encrypted at rest. Does NOT validate — use
   * {@link validateAndPersist} for the user-facing flow.
   */
  set(key: string): void {
    if (!this.safe.isEncryptionAvailable()) {
      throw new Error("safeStorage is not available on this system");
    }
    const encrypted = this.safe.encryptString(key).toString("base64");
    this.store.set("encryptedAnthropicAdminKey", encrypted);
    if (!this.store.get("anthropicAdminKeySetAt")) {
      this.store.set("anthropicAdminKeySetAt", this.now());
    }
  }

  clear(): void {
    this.store.delete("encryptedAnthropicAdminKey");
    this.store.delete("anthropicAdminKeySetAt");
    this.store.delete("anthropicAdminKeyLastValidatedAt");
  }

  getStatus(): AnthropicAdminKeyStatus {
    const has = Boolean(this.store.get("encryptedAnthropicAdminKey"));
    if (!has) {
      return { set: false };
    }
    const status: AnthropicAdminKeyStatus = { set: true };
    const setAt = this.store.get("anthropicAdminKeySetAt");
    if (setAt) {
      status.setAt = setAt;
    }
    const lastValidatedAt = this.store.get("anthropicAdminKeyLastValidatedAt");
    if (lastValidatedAt) {
      status.lastValidatedAt = lastValidatedAt;
    }
    return status;
  }

  /**
   * Validates the candidate Admin Key by calling the Anthropic Cost API with a
   * 1-day window. Persists only on success (2xx). All failures surface as
   * generic outcome codes; the raw error and key are never returned or
   * logged at this layer.
   */
  async validateAndPersist(candidateKey: string): Promise<AnthropicValidationOutcome> {
    if (!this.safe.isEncryptionAvailable()) {
      return { ok: false, error: "safe_storage_unavailable" };
    }
    const trimmed = candidateKey.trim();
    if (!trimmed) {
      return { ok: false, error: "401" };
    }
    const endingAt = new Date();
    const startingAt = new Date(endingAt.getTime() - 24 * 60 * 60 * 1000);
    try {
      await this.fetchCostReport(trimmed, {
        startingAt: startingAt.toISOString(),
        endingAt: endingAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof AnthropicAuthError) {
        return { ok: false, error: err.status === 403 ? "403" : "401" };
      }
      if (err instanceof AnthropicRateLimitedError) {
        return { ok: false, error: "rate_limited" };
      }
      if (err instanceof AnthropicMalformedResponseError) {
        return { ok: false, error: "malformed" };
      }
      if (err instanceof AnthropicNetworkError) {
        return { ok: false, error: "network" };
      }
      // Unknown error class — keep generic. Do NOT include err.message because
      // it could echo the Admin Key in pathological cases.
      return { ok: false, error: "network" };
    }
    this.set(trimmed);
    this.store.set("anthropicAdminKeyLastValidatedAt", this.now());
    return { ok: true, status: this.getStatus() };
  }
}

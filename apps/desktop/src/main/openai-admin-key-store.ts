import Store from "electron-store";
import {
  getElectronSafeStorage,
  type SafeStorageLike,
} from "./electron-safe-storage.js";
import {
  fetchOpenAICosts,
  OpenAIAuthError,
  OpenAINetworkError,
  OpenAIRateLimitedError,
  OpenAIMalformedResponseError,
} from "./openai-admin-client.js";

/**
 * Encrypted persistence for the OpenAI organization Admin Key. The key
 * authorizes the OpenAI Cost API (FEA-1435 nightly reconciliation).
 *
 * Pattern mirrors {@link AnthropicAdminKeyStore}: electron-store + safeStorage.
 * The Admin Key is extremely sensitive — it MUST NEVER appear in logs, error
 * messages, telemetry, or thrown error strings. Validation errors surface only
 * generic codes (`401`, `403`, `network`, `rate_limited`, `malformed`).
 */

export type OpenAIAdminKeyStatus = {
  set: boolean;
  setAt?: string;
  lastValidatedAt?: string;
};

export type OpenAIValidationOutcome =
  | { ok: true; status: OpenAIAdminKeyStatus }
  | { ok: false; error: "401" | "403" | "network" | "rate_limited" | "malformed" | "safe_storage_unavailable" };

type OpenAIAdminKeySchema = {
  encryptedOpenAIAdminKey?: string;
  openaiAdminKeySetAt?: string;
  openaiAdminKeyLastValidatedAt?: string;
  [key: string]: string | undefined;
};

export interface OpenAIAdminKeyStoreOptions {
  cwd?: string;
  name?: string;
  /** Test-only override; production omits this. */
  safeStorage?: SafeStorageLike;
  /** Test-only override of the costs fetcher; production omits this. */
  fetchCosts?: typeof fetchOpenAICosts;
  /** Test-only override of the clock; production omits this. */
  now?: () => string;
}

export class OpenAIAdminKeyStore {
  private readonly store: Store<OpenAIAdminKeySchema>;
  private readonly safe: SafeStorageLike;
  private readonly fetchCosts: typeof fetchOpenAICosts;
  private readonly now: () => string;

  constructor(options?: OpenAIAdminKeyStoreOptions) {
    this.safe = getElectronSafeStorage(
      options?.safeStorage,
      "OpenAIAdminKeyStore",
    );
    this.store = new Store<OpenAIAdminKeySchema>({
      name: options?.name ?? "desktop-openai-admin-key",
      cwd: options?.cwd,
    });
    this.fetchCosts = options?.fetchCosts ?? fetchOpenAICosts;
    this.now = options?.now ?? (() => new Date().toISOString());
  }

  /** Returns the plaintext Admin Key or null when unset/undecryptable. */
  get(): string | null {
    const encrypted = this.store.get("encryptedOpenAIAdminKey");
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
    this.store.set("encryptedOpenAIAdminKey", encrypted);
    if (!this.store.get("openaiAdminKeySetAt")) {
      this.store.set("openaiAdminKeySetAt", this.now());
    }
  }

  clear(): void {
    this.store.delete("encryptedOpenAIAdminKey");
    this.store.delete("openaiAdminKeySetAt");
    this.store.delete("openaiAdminKeyLastValidatedAt");
  }

  getStatus(): OpenAIAdminKeyStatus {
    const has = Boolean(this.store.get("encryptedOpenAIAdminKey"));
    if (!has) {
      return { set: false };
    }
    const status: OpenAIAdminKeyStatus = { set: true };
    const setAt = this.store.get("openaiAdminKeySetAt");
    if (setAt) {
      status.setAt = setAt;
    }
    const lastValidatedAt = this.store.get("openaiAdminKeyLastValidatedAt");
    if (lastValidatedAt) {
      status.lastValidatedAt = lastValidatedAt;
    }
    return status;
  }

  /**
   * Validates the candidate Admin Key by calling the OpenAI Cost API with a
   * 1-day window. Persists only on success (2xx). All failures surface as
   * generic outcome codes; the raw error and key are never returned or
   * logged at this layer.
   */
  async validateAndPersist(candidateKey: string): Promise<OpenAIValidationOutcome> {
    if (!this.safe.isEncryptionAvailable()) {
      return { ok: false, error: "safe_storage_unavailable" };
    }
    const trimmed = candidateKey.trim();
    if (!trimmed) {
      return { ok: false, error: "401" };
    }
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - 24 * 60 * 60;
    try {
      await this.fetchCosts(trimmed, { startTime, endTime });
    } catch (err) {
      if (err instanceof OpenAIAuthError) {
        return { ok: false, error: err.status === 403 ? "403" : "401" };
      }
      if (err instanceof OpenAIRateLimitedError) {
        return { ok: false, error: "rate_limited" };
      }
      if (err instanceof OpenAIMalformedResponseError) {
        return { ok: false, error: "malformed" };
      }
      if (err instanceof OpenAINetworkError) {
        return { ok: false, error: "network" };
      }
      return { ok: false, error: "network" };
    }
    this.set(trimmed);
    this.store.set("openaiAdminKeyLastValidatedAt", this.now());
    return { ok: true, status: this.getStatus() };
  }
}

import Store from "electron-store";
import {
  getElectronSafeStorage,
  type SafeStorageLike,
} from "./electron-safe-storage.js";

export type { SafeStorageLike } from "./electron-safe-storage.js";

/**
 * Metadata stored alongside a loop runner auth token.
 * `expiresAt` is a Unix epoch in milliseconds (from JWT `exp` * 1000).
 * `jti` is the JWT ID used for idempotency tracking on the server side.
 * `lastIdempotencyKey` is persisted so the same key can be reused after a
 * force-quit and restart (AC-011).
 */
export type LoopTokenMeta = {
  token: string;
  expiresAt?: number;
  jti?: string;
  lastIdempotencyKey?: string;
};

/**
 * Extract the `exp` claim from a JWT without using any external library.
 * Manually splits on `.`, base64url-decodes the payload segment, JSON-parses
 * it, and returns `exp * 1000` as a millisecond Unix timestamp.
 *
 * Returns `undefined` for any malformed input (wrong number of segments,
 * non-JSON payload, missing or non-numeric `exp`). The token is then treated
 * as opaque by callers.
 */
export function extractJwtExp(token: string): number | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return undefined;
    }
    const payload = parts[1];
    // base64url -> base64 -> Buffer
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(padded, "base64").toString("utf-8");
    const parsed: unknown = JSON.parse(decoded);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !("exp" in parsed) ||
      typeof (parsed as Record<string, unknown>)["exp"] !== "number"
    ) {
      return undefined;
    }
    return (parsed as Record<string, number>)["exp"] * 1000;
  } catch {
    return undefined;
  }
}

type LoopTokenStoreSchema = {
  encryptedLoopTokens: Record<string, string>;
};

export interface LoopTokenStoreOptions {
  cwd?: string;
  name?: string;
  /**
   * When set (e.g. in unit tests under Node), uses this instead of Electron safeStorage.
   * Production callers omit this and resolve safeStorage from the Electron main process.
   */
  safeStorage?: SafeStorageLike;
}

/**
 * Encrypted persistence for per-loop runner auth tokens, keyed by `loopId`.
 * Uses the same pattern as {@link ApiKeyStore}: electron-store + safeStorage.
 */
export class LoopTokenStore {
  private readonly store: Store<LoopTokenStoreSchema>;
  private readonly safe: SafeStorageLike;

  constructor(options?: LoopTokenStoreOptions) {
    this.safe = getElectronSafeStorage(options?.safeStorage, "LoopTokenStore");
    this.store = new Store<LoopTokenStoreSchema>({
      name: options?.name ?? "desktop-loop-tokens",
      cwd: options?.cwd,
      defaults: {
        encryptedLoopTokens: {},
      },
    });
  }

  private getEncryptedMap(): Record<string, string> {
    const raw = this.store.get("encryptedLoopTokens");
    return raw && typeof raw === "object" ? { ...raw } : {};
  }

  private setEncryptedMap(map: Record<string, string>): void {
    this.store.set("encryptedLoopTokens", map);
  }

  setLoopToken(loopId: string, token: string): void {
    // Extract `exp` from the JWT (when present) so `scheduleProactiveRefresh`
    // can arm a timer on first persist. Without this, refresh would only ever
    // activate after a 401-driven response populated `expiresAt`, defeating
    // AC-004 (proactive refresh) for every newly-spawned loop.
    const expiresAt = extractJwtExp(token);
    const meta: LoopTokenMeta =
      expiresAt !== undefined ? { token, expiresAt } : { token };
    this.setLoopTokenWithMeta(loopId, meta);
  }

  getLoopToken(loopId: string): string | null {
    const meta = this.getLoopTokenWithMeta(loopId);
    return meta ? meta.token : null;
  }

  /**
   * Persist a full {@link LoopTokenMeta} object for `loopId`.
   * The meta is JSON-serialized and then encrypted as a single string.
   * Callers that only have a plain token string should use {@link setLoopToken}.
   */
  setLoopTokenWithMeta(loopId: string, meta: LoopTokenMeta): void {
    if (!this.safe.isEncryptionAvailable()) {
      throw new Error("safeStorage is not available on this system");
    }
    const serialized = JSON.stringify(meta);
    const encrypted = this.safe.encryptString(serialized).toString("base64");
    const map = this.getEncryptedMap();
    map[loopId] = encrypted;
    this.setEncryptedMap(map);
  }

  /**
   * Retrieve {@link LoopTokenMeta} for `loopId`.
   *
   * Discriminator logic: after decryption, if the value starts with `{` it is
   * treated as a JSON-serialized `LoopTokenMeta`; otherwise it is a legacy
   * plain-string token and is wrapped in a minimal meta object for callers.
   * This ensures backward compatibility with entries written by
   * {@link setLoopToken} before this schema extension was introduced.
   */
  getLoopTokenWithMeta(loopId: string): LoopTokenMeta | null {
    const encrypted = this.getEncryptedMap()[loopId];
    if (!encrypted) {
      return null;
    }
    if (!this.safe.isEncryptionAvailable()) {
      return null;
    }
    try {
      const decrypted = this.safe
        .decryptString(Buffer.from(encrypted, "base64"))
        .trim();
      if (decrypted.length === 0) {
        return null;
      }
      // Discriminator: JSON object vs legacy plain token string.
      if (decrypted.startsWith("{")) {
        const parsed: unknown = JSON.parse(decrypted);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          "token" in parsed &&
          typeof (parsed as Record<string, unknown>)["token"] === "string"
        ) {
          return parsed as LoopTokenMeta;
        }
        // Malformed JSON object — treat as opaque token string.
        return { token: decrypted };
      }
      // Legacy single-string entry.
      return { token: decrypted };
    } catch {
      return null;
    }
  }

  deleteLoopToken(loopId: string): void {
    const map = this.getEncryptedMap();
    if (!(loopId in map)) {
      return;
    }
    delete map[loopId];
    this.setEncryptedMap(map);
  }

  listLoopIds(): string[] {
    return Object.keys(this.getEncryptedMap());
  }
}

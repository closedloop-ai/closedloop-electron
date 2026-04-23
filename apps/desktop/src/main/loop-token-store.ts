import { createRequire } from "node:module";
import Store from "electron-store";

const require = createRequire(import.meta.url);

/**
 * Subset of Electron safeStorage used by this store (injectable for Node tests).
 */
export type SafeStorageLike = {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
};

type LoopTokenStoreSchema = {
  encryptedLoopTokens: Record<string, string>;
  /**
   * Per-(loopId, fullName) tokens for additional-repo commit/push/PR on
   * EXECUTE. Keyed by `${loopId}\x00${fullName}` so that fullName values
   * containing ':' or '/' (e.g. "owner/repo") do not collide with the
   * delimiter. Encrypted via safeStorage, same pattern as the primary
   * loop-token map.
   */
  encryptedAdditionalRepoTokens: Record<string, string>;
};

/** Delimiter between loopId and fullName in the additional-repo token key. */
const ADDITIONAL_REPO_TOKEN_KEY_DELIMITER = "\x00";

function additionalRepoTokenKey(loopId: string, fullName: string): string {
  return `${loopId}${ADDITIONAL_REPO_TOKEN_KEY_DELIMITER}${fullName}`;
}

function parseAdditionalRepoTokenKey(
  key: string,
): { loopId: string; fullName: string } | null {
  const idx = key.indexOf(ADDITIONAL_REPO_TOKEN_KEY_DELIMITER);
  if (idx < 0) {
    return null;
  }
  return {
    loopId: key.slice(0, idx),
    fullName: key.slice(idx + 1),
  };
}

export interface LoopTokenStoreOptions {
  cwd?: string;
  name?: string;
  /**
   * When set (e.g. in unit tests under Node), uses this instead of Electron safeStorage.
   * Production callers omit this and resolve safeStorage from the Electron main process.
   */
  safeStorage?: SafeStorageLike;
}

function resolveSafeStorage(override?: SafeStorageLike): SafeStorageLike {
  if (override) {
    return override;
  }
  try {
    const electron = require("electron") as unknown;
    if (
      electron &&
      typeof electron === "object" &&
      electron !== null &&
      "safeStorage" in electron
    ) {
      const ss = (electron as { safeStorage?: SafeStorageLike }).safeStorage;
      if (
        ss &&
        typeof ss.isEncryptionAvailable === "function" &&
        typeof ss.encryptString === "function" &&
        typeof ss.decryptString === "function"
      ) {
        return ss;
      }
    }
  } catch {
    /* not running in Electron */
  }
  throw new Error(
    "LoopTokenStore requires Electron main process or options.safeStorage",
  );
}

/**
 * Encrypted persistence for per-loop runner auth tokens, keyed by `loopId`.
 * Uses the same pattern as {@link ApiKeyStore}: electron-store + safeStorage.
 */
export class LoopTokenStore {
  private readonly store: Store<LoopTokenStoreSchema>;
  private readonly safe: SafeStorageLike;

  constructor(options?: LoopTokenStoreOptions) {
    this.safe = resolveSafeStorage(options?.safeStorage);
    this.store = new Store<LoopTokenStoreSchema>({
      name: options?.name ?? "desktop-loop-tokens",
      cwd: options?.cwd,
      defaults: {
        encryptedLoopTokens: {},
        encryptedAdditionalRepoTokens: {},
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

  private getAdditionalRepoMap(): Record<string, string> {
    const raw = this.store.get("encryptedAdditionalRepoTokens");
    return raw && typeof raw === "object" ? { ...raw } : {};
  }

  private setAdditionalRepoMap(map: Record<string, string>): void {
    this.store.set("encryptedAdditionalRepoTokens", map);
  }

  setLoopToken(loopId: string, token: string): void {
    if (!this.safe.isEncryptionAvailable()) {
      throw new Error("safeStorage is not available on this system");
    }
    const encrypted = this.safe.encryptString(token).toString("base64");
    const map = this.getEncryptedMap();
    map[loopId] = encrypted;
    this.setEncryptedMap(map);
  }

  getLoopToken(loopId: string): string | null {
    const encrypted = this.getEncryptedMap()[loopId];
    if (!encrypted) {
      return null;
    }
    if (!this.safe.isEncryptionAvailable()) {
      return null;
    }
    try {
      const token = this.safe.decryptString(Buffer.from(encrypted, "base64"));
      const trimmed = token.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }

  /**
   * Delete the primary loop token and all additional-repo tokens for a loopId.
   * Kept as a single operation so callers don't have to remember to sweep both
   * maps — additional-repo tokens are per-loop secrets with the same lifetime.
   */
  deleteLoopToken(loopId: string): void {
    const map = this.getEncryptedMap();
    if (loopId in map) {
      delete map[loopId];
      this.setEncryptedMap(map);
    }
    this.deleteAdditionalRepoTokens(loopId);
  }

  listLoopIds(): string[] {
    return Object.keys(this.getEncryptedMap());
  }

  /**
   * Persist a per-repo token for an additional repo pushed during EXECUTE.
   * Keyed by (loopId, fullName) so boot-recovery can authenticate
   * commit/push/PR flows for repos whose worktrees already exist on disk.
   */
  setAdditionalRepoToken(loopId: string, fullName: string, token: string): void {
    if (!this.safe.isEncryptionAvailable()) {
      throw new Error("safeStorage is not available on this system");
    }
    const encrypted = this.safe.encryptString(token).toString("base64");
    const map = this.getAdditionalRepoMap();
    map[additionalRepoTokenKey(loopId, fullName)] = encrypted;
    this.setAdditionalRepoMap(map);
  }

  getAdditionalRepoToken(loopId: string, fullName: string): string | null {
    const encrypted = this.getAdditionalRepoMap()[additionalRepoTokenKey(loopId, fullName)];
    if (!encrypted) {
      return null;
    }
    if (!this.safe.isEncryptionAvailable()) {
      return null;
    }
    try {
      const token = this.safe.decryptString(Buffer.from(encrypted, "base64"));
      const trimmed = token.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }

  /** Delete all additional-repo tokens belonging to a loopId. */
  deleteAdditionalRepoTokens(loopId: string): void {
    const map = this.getAdditionalRepoMap();
    let changed = false;
    for (const key of Object.keys(map)) {
      const parsed = parseAdditionalRepoTokenKey(key);
      if (parsed?.loopId === loopId) {
        delete map[key];
        changed = true;
      }
    }
    if (changed) {
      this.setAdditionalRepoMap(map);
    }
  }
}

import Store from "electron-store";
import {
  getElectronSafeStorage,
  type SafeStorageLike,
} from "./electron-safe-storage.js";

export type { SafeStorageLike } from "./electron-safe-storage.js";

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

import { createRequire } from "node:module";
import Store from "electron-store";

const require = createRequire(import.meta.url);

type SecretsSchema = {
  encryptedApiKey?: string;
  [key: string]: string | undefined;
};

export type ApiKeyStatus = {
  hasApiKey: boolean;
  source: "safeStorage" | "environment" | "none";
  environmentVariable?: "CLOSEDLOOP_API_KEY" | "SYMPHONY_API_KEY";
};

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface ApiKeyStoreOptions {
  cwd?: string;
  name?: string;
  safeStorage?: SafeStorageLike;
}

function getDefaultSafeStorage(): SafeStorageLike {
  // Lazy import Electron's safeStorage to allow testing without Electron
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { safeStorage } = require("electron") as { safeStorage: SafeStorageLike };
  return safeStorage;
}

export class ApiKeyStore {
  private readonly store: Store<SecretsSchema>;
  private readonly safeStorage: SafeStorageLike;

  constructor(options?: ApiKeyStoreOptions) {
    this.store = new Store<SecretsSchema>({
      name: options?.name ?? "desktop-secrets",
      cwd: options?.cwd
    });
    this.safeStorage = options?.safeStorage ?? getDefaultSafeStorage();
  }

  getApiKey(): string | null {
    const encryptedApiKey = this.store.get("encryptedApiKey");
    if (!encryptedApiKey) {
      return this.getEnvironmentApiKey()?.value ?? null;
    }

    if (!this.safeStorage.isEncryptionAvailable()) {
      return null;
    }

    try {
      return this.safeStorage.decryptString(Buffer.from(encryptedApiKey, "base64"));
    } catch {
      return null;
    }
  }

  getStatus(): ApiKeyStatus {
    const encryptedApiKey = this.store.get("encryptedApiKey");
    if (encryptedApiKey) {
      const decrypted = this.getApiKey();
      return {
        hasApiKey: Boolean(decrypted),
        source: decrypted ? "safeStorage" : "none"
      };
    }

    const envApiKey = this.getEnvironmentApiKey();
    if (envApiKey) {
      return {
        hasApiKey: true,
        source: "environment",
        environmentVariable: envApiKey.environmentVariable
      };
    }

    return {
      hasApiKey: false,
      source: "none"
    };
  }

  setApiKey(apiKey: string): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage is not available on this system");
    }

    const encrypted = this.safeStorage.encryptString(apiKey);
    this.store.set("encryptedApiKey", encrypted.toString("base64"));
  }

  clearApiKey(): void {
    this.store.delete("encryptedApiKey");
  }

  saveProfileKey(profileId: string, key: string): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage is not available on this system");
    }
    const encrypted = this.safeStorage.encryptString(key);
    this.store.set(`profile:${profileId}`, encrypted.toString("base64"));
  }

  getProfileKey(profileId: string): string | null {
    const encryptedValue = this.store.get(`profile:${profileId}` as keyof SecretsSchema);
    if (!encryptedValue) {
      return null;
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      return null;
    }
    try {
      return this.safeStorage.decryptString(Buffer.from(encryptedValue, "base64"));
    } catch {
      return null;
    }
  }

  deleteProfileKey(profileId: string): void {
    this.store.delete(`profile:${profileId}` as keyof SecretsSchema);
  }

  private getEnvironmentApiKey():
    | { value: string; environmentVariable: "CLOSEDLOOP_API_KEY" | "SYMPHONY_API_KEY" }
    | null {
    const closedloopKey = process.env.CLOSEDLOOP_API_KEY?.trim();
    if (closedloopKey) {
      return {
        value: closedloopKey,
        environmentVariable: "CLOSEDLOOP_API_KEY"
      };
    }

    const symphonyKey = process.env.SYMPHONY_API_KEY?.trim();
    if (symphonyKey) {
      return {
        value: symphonyKey,
        environmentVariable: "SYMPHONY_API_KEY"
      };
    }

    return null;
  }
}

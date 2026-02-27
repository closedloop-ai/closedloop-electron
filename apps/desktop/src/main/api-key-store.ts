import { safeStorage } from "electron";
import Store from "electron-store";

type SecretsSchema = {
  encryptedApiKey?: string;
};

export type ApiKeyStatus = {
  hasApiKey: boolean;
  source: "safeStorage" | "environment" | "none";
  environmentVariable?: "CLOSEDLOOP_API_KEY" | "SYMPHONY_API_KEY";
};

export class ApiKeyStore {
  private readonly store: Store<SecretsSchema>;

  constructor() {
    this.store = new Store<SecretsSchema>({
      name: "desktop-secrets"
    });
  }

  getApiKey(): string | null {
    const encryptedApiKey = this.store.get("encryptedApiKey");
    if (!encryptedApiKey) {
      return this.getEnvironmentApiKey()?.value ?? null;
    }

    if (!safeStorage.isEncryptionAvailable()) {
      return null;
    }

    try {
      return safeStorage.decryptString(Buffer.from(encryptedApiKey, "base64"));
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
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage is not available on this system");
    }

    const encrypted = safeStorage.encryptString(apiKey);
    this.store.set("encryptedApiKey", encrypted.toString("base64"));
  }

  clearApiKey(): void {
    this.store.delete("encryptedApiKey");
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

import Store from "electron-store";
import {
  DEFAULT_DESKTOP_SETTINGS,
  type AlwaysAllowRule,
  type DesktopSettings,
  type RiskTier
} from "../shared/contracts.js";

export class SettingsStore {
  private readonly store: Store<DesktopSettings>;

  constructor() {
    this.store = new Store<DesktopSettings>({
      name: "desktop-settings",
      defaults: DEFAULT_DESKTOP_SETTINGS
    });
  }

  getAll(): DesktopSettings {
    return { ...DEFAULT_DESKTOP_SETTINGS, ...this.store.store };
  }

  getApiOrigin(): string {
    return this.store.get("apiOrigin", DEFAULT_DESKTOP_SETTINGS.apiOrigin);
  }

  getWebAppOrigin(): string {
    return this.store.get("webAppOrigin", DEFAULT_DESKTOP_SETTINGS.webAppOrigin);
  }

  getAllowedDirectories(): string[] {
    return this.store.get("allowedDirectories", DEFAULT_DESKTOP_SETTINGS.allowedDirectories);
  }

  getSandboxBaseDirectory(): string {
    return this.store.get("sandboxBaseDirectory", DEFAULT_DESKTOP_SETTINGS.sandboxBaseDirectory);
  }

  getOnboardingCompleted(): boolean {
    return this.store.get("onboardingCompleted", DEFAULT_DESKTOP_SETTINGS.onboardingCompleted);
  }

  getCloudCommandsPaused(): boolean {
    return this.store.get("cloudCommandsPaused", DEFAULT_DESKTOP_SETTINGS.cloudCommandsPaused);
  }

  getCloudConnectionEnabled(): boolean {
    return this.store.get("cloudConnectionEnabled", DEFAULT_DESKTOP_SETTINGS.cloudConnectionEnabled);
  }

  getDefaultApprovalTier(): RiskTier {
    return this.store.get("defaultApprovalTier", DEFAULT_DESKTOP_SETTINGS.defaultApprovalTier);
  }

  setAllowedDirectories(allowedDirectories: string[]): void {
    this.store.set("allowedDirectories", allowedDirectories);
  }

  setSandboxBaseDirectory(sandboxBaseDirectory: string): void {
    this.store.set("sandboxBaseDirectory", sandboxBaseDirectory);
  }

  setOnboardingCompleted(onboardingCompleted: boolean): void {
    this.store.set("onboardingCompleted", onboardingCompleted);
  }

  setCloudCommandsPaused(cloudCommandsPaused: boolean): void {
    this.store.set("cloudCommandsPaused", cloudCommandsPaused);
  }

  setCloudConnectionEnabled(cloudConnectionEnabled: boolean): void {
    this.store.set("cloudConnectionEnabled", cloudConnectionEnabled);
  }

  setDefaultApprovalTier(defaultApprovalTier: RiskTier): void {
    this.store.set("defaultApprovalTier", defaultApprovalTier);
  }

  setApiOrigin(apiOrigin: string): void {
    this.store.set("apiOrigin", apiOrigin);
  }

  setWebAppOrigin(webAppOrigin: string): void {
    this.store.set("webAppOrigin", webAppOrigin);
  }

  setApprovalRule(operationName: string, tier: RiskTier): void {
    const rules = this.store.get("autoApprovalRules", DEFAULT_DESKTOP_SETTINGS.autoApprovalRules);
    rules[operationName] = tier;
    this.store.set("autoApprovalRules", rules);
  }

  setAutoApprovalRules(autoApprovalRules: Record<string, RiskTier>): void {
    this.store.set("autoApprovalRules", autoApprovalRules);
  }

  setAlwaysAllowRules(alwaysAllowRules: AlwaysAllowRule[]): void {
    this.store.set("alwaysAllowRules", alwaysAllowRules);
  }

  update(partial: Partial<DesktopSettings>): DesktopSettings {
    if (partial.allowedDirectories) {
      this.store.set("allowedDirectories", partial.allowedDirectories);
    }
    if (typeof partial.sandboxBaseDirectory === "string") {
      this.store.set("sandboxBaseDirectory", partial.sandboxBaseDirectory);
    }
    if (typeof partial.onboardingCompleted === "boolean") {
      this.store.set("onboardingCompleted", partial.onboardingCompleted);
    }
    if (typeof partial.cloudCommandsPaused === "boolean") {
      this.store.set("cloudCommandsPaused", partial.cloudCommandsPaused);
    }
    if (typeof partial.cloudConnectionEnabled === "boolean") {
      this.store.set("cloudConnectionEnabled", partial.cloudConnectionEnabled);
    }
    if (typeof partial.apiOrigin === "string") {
      this.store.set("apiOrigin", partial.apiOrigin);
    }
    if (typeof partial.webAppOrigin === "string") {
      this.store.set("webAppOrigin", partial.webAppOrigin);
    }
    if (partial.autoApprovalRules) {
      this.store.set("autoApprovalRules", partial.autoApprovalRules);
    }
    if (partial.alwaysAllowRules) {
      this.store.set("alwaysAllowRules", partial.alwaysAllowRules);
    }
    if (partial.defaultApprovalTier) {
      this.store.set("defaultApprovalTier", partial.defaultApprovalTier);
    }
    return this.getAll();
  }
}

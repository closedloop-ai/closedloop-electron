import { createServer, type Server } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_GATEWAY_PORT,
  FALLBACK_GATEWAY_PORTS,
  type ComputeTargetCapabilities,
  type HealthResponse,
} from "../shared/contracts.js";
import { gatewayLog } from "../main/gateway-logger.js";
import type { LocalSessionStore } from "../main/local-session-store.js";
import type { JobStore } from "../main/job-store.js";
import type { LoopTokenStore } from "../main/loop-token-store.js";
import {
  GatewayRouter,
  type GatewayActivityEvent,
  type GatewayApprovalRequest,
  type GatewayApprovalResult,
} from "./router.js";
import type { WorktreeProvider } from "./operations/symphony-loop.js";
import type { RetrySpawnDeps } from "../main/spawn-retry.js";

export interface DesktopGatewayServerOptions {
  host: string;
  preferredPort: number;
  fallbackPorts: readonly number[];
  webAppOrigin: string;
  getWebAppOrigin?: () => string;
  getGatewayAuthToken?: () => string | undefined;
  getAllowedDirectories: () => string[];
  getSymphonyDir?: () => string;
  fallbackEngineerOrigin?: string;
  onActivityEvent?: (event: GatewayActivityEvent) => void;
  evaluateApproval?: (
    request: GatewayApprovalRequest,
  ) => GatewayApprovalResult | Promise<GatewayApprovalResult>;
  machineName: string;
  version: string;
  capabilities: ComputeTargetCapabilities;
  getCapabilities?: () => ComputeTargetCapabilities;
  discoveryFilePath?: string;
  sessionStore?: LocalSessionStore;
  getApiKey?: () => string | null;
  getApiOrigin?: () => string;
  prodOriginsOnly?: boolean;
  jobStore?: JobStore;
  worktreeProvider?: WorktreeProvider;
  retrySpawnDeps?: RetrySpawnDeps;
  onUnexpectedClose?: () => void;
  loopTokenStore?: LoopTokenStore;
}

export class DesktopGatewayServer {
  private readonly options: DesktopGatewayServerOptions;
  private readonly router: GatewayRouter;
  private server: Server | null = null;
  private alive = false;
  private activePort: number;

  constructor(options: DesktopGatewayServerOptions) {
    this.options = {
      ...options,
      discoveryFilePath:
        options.discoveryFilePath ??
        path.join(os.homedir(), ".closedloop-ai", "electron-port"),
    };
    this.activePort = this.options.preferredPort;
    this.router = new GatewayRouter({
      webAppOrigin: this.options.webAppOrigin,
      getWebAppOrigin: this.options.getWebAppOrigin,
      getGatewayAuthToken: this.options.getGatewayAuthToken,
      machineName: this.options.machineName,
      version: this.options.version,
      capabilities: this.options.capabilities,
      getCapabilities: this.options.getCapabilities,
      getActivePort: () => this.activePort,
      getAllowedDirectories: this.options.getAllowedDirectories,
      getSymphonyDir: this.options.getSymphonyDir,
      fallbackEngineerOrigin: this.options.fallbackEngineerOrigin,
      onActivityEvent: this.options.onActivityEvent,
      evaluateApproval: this.options.evaluateApproval,
      sessionStore: this.options.sessionStore,
      getApiKey: this.options.getApiKey,
      getApiOrigin: this.options.getApiOrigin,
      prodOriginsOnly: this.options.prodOriginsOnly,
      jobStore: this.options.jobStore,
      worktreeProvider: this.options.worktreeProvider,
      loopTokenStore: this.options.loopTokenStore,
      retrySpawnDeps: this.options.retrySpawnDeps,
    });
  }

  static createDefault(
    webAppOrigin: string,
    getGatewayAuthToken: () => string | undefined,
    getAllowedDirectories: () => string[],
    machineName: string,
    version: string,
    capabilities: ComputeTargetCapabilities,
    getCapabilities?: () => ComputeTargetCapabilities,
    onActivityEvent?: (event: GatewayActivityEvent) => void,
    evaluateApproval?: (
      request: GatewayApprovalRequest,
    ) => GatewayApprovalResult | Promise<GatewayApprovalResult>,
    getSymphonyDir?: () => string,
    sessionStore?: LocalSessionStore,
    getApiKey?: () => string | null,
    getApiOrigin?: () => string,
    getWebAppOrigin?: () => string,
    prodOriginsOnly?: boolean,
    jobStore?: JobStore,
    onUnexpectedClose?: () => void,
    loopTokenStore?: LoopTokenStore,
    retrySpawnDeps?: RetrySpawnDeps,
  ): DesktopGatewayServer {
    return new DesktopGatewayServer({
      host: "127.0.0.1",
      preferredPort: DEFAULT_GATEWAY_PORT,
      fallbackPorts: FALLBACK_GATEWAY_PORTS,
      webAppOrigin,
      getWebAppOrigin,
      getGatewayAuthToken,
      getAllowedDirectories,
      getSymphonyDir,
      fallbackEngineerOrigin: process.env.SYMPHONY_ENGINEER_FALLBACK_ORIGIN,
      onActivityEvent,
      evaluateApproval,
      machineName,
      version,
      capabilities,
      getCapabilities,
      sessionStore,
      getApiKey,
      getApiOrigin,
      prodOriginsOnly,
      jobStore,
      onUnexpectedClose,
      loopTokenStore,
      retrySpawnDeps,
    });
  }

  getAddress(): DesktopGatewayServerOptions {
    return this.options;
  }

  getActivePort(): number {
    return this.activePort;
  }

  getHealthResponse(): HealthResponse {
    const capabilities = this.options.getCapabilities?.() ?? this.options.capabilities;
    return {
      status: "ok",
      machineName: this.options.machineName,
      capabilities,
      version: this.options.version,
      port: this.activePort,
    };
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const candidates = [
      this.options.preferredPort,
      ...this.options.fallbackPorts,
    ];
    let lastError: Error | null = null;

    for (const candidate of candidates) {
      const candidateServer = createServer((request, response) => {
        void this.router.handle(request, response);
      });

      try {
        await this.listen(candidateServer, candidate);
        this.server = candidateServer;
        this.alive = true;
        const addr = candidateServer.address();
        this.activePort =
          typeof addr === "object" && addr ? addr.port : candidate;
        candidateServer.on("error", (err) => {
          gatewayLog.error("gateway-server", `Server error: ${err.message}`);
        });
        candidateServer.on("close", () => {
          if (this.server === candidateServer) {
            this.alive = false;
            this.server = null;
            gatewayLog.warn("gateway-server", "Server closed unexpectedly");
            this.options.onUnexpectedClose?.();
          }
        });
        await this.writeDiscoveryFile();
        return;
      } catch (error) {
        candidateServer.removeAllListeners();
        candidateServer.close();
        const boundError = error as NodeJS.ErrnoException;
        if (boundError.code === "EADDRINUSE") {
          lastError = boundError;
          continue;
        }
        throw error;
      }
    }

    throw new Error(
      `failed to bind gateway server to any candidate port (${candidates.join(", ")}): ${lastError?.message ?? "unknown error"}`,
    );
  }

  async stop(): Promise<void> {
    this.alive = false;
    if (!this.server) {
      return;
    }

    const runningServer = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      runningServer.close((error) => {
        if (
          error &&
          (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
        ) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  isAlive(): boolean {
    return this.alive && this.server !== null && this.server.listening;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private async listen(server: Server, port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, this.options.host, () => resolve());
    });
  }

  private async writeDiscoveryFile(): Promise<void> {
    if (!this.options.discoveryFilePath) {
      return;
    }

    const discoveryDirectory = path.dirname(this.options.discoveryFilePath);
    await fs.mkdir(discoveryDirectory, { recursive: true });
    await fs.writeFile(
      this.options.discoveryFilePath,
      String(this.activePort),
      "utf-8",
    );
  }
}

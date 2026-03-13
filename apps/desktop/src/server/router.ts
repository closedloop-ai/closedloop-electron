import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { ComputeTargetCapabilities, HealthResponse } from "../shared/contracts.js";
import type { LocalSessionStore } from "../main/local-session-store.js";
import { verifyChallenge } from "../main/local-auth-verifier.js";
import { OperationDispatcher } from "./operation-dispatcher.js";
import { registerFilesystemDirectoriesRoutes } from "./operations/filesystem-directories.js";
import { registerFilesystemSearchRoutes } from "./operations/filesystem-search.js";
import { registerDeployRoutes } from "./operations/deploy.js";
import { registerCodexRoutes } from "./operations/codex.js";
import { registerGitActionRoutes } from "./operations/git-action.js";
import { registerGitBranchesRoutes } from "./operations/git-branches.js";
import { registerGitDiffRoutes } from "./operations/git-diff.js";
import { registerGitPrRoutes } from "./operations/git-pr.js";
import { registerGitWorktreeRoutes } from "./operations/git-worktree.js";
import { registerHealthCheckRoutes } from "./operations/health-check.js";
import { registerLearningsRoutes } from "./operations/learnings.js";
import { registerMetadataRoutes } from "./operations/metadata-routes.js";
import { registerReposConfigRoutes } from "./operations/repos-config.js";
import { registerRunViewerChatRoutes } from "./operations/run-viewer-chat.js";
import { registerRunViewerExtractRoutes } from "./operations/run-viewer-extract.js";
import { registerSymphonyAttachmentsRoutes } from "./operations/symphony-attachments.js";
import { registerSymphonyChatHistoryRoutes } from "./operations/symphony-chat-history.js";
import { registerSymphonyJudgesRoutes } from "./operations/symphony-judges.js";
import { registerSymphonyKillRoutes } from "./operations/symphony-kill.js";
import { registerSymphonyLogsRoutes } from "./operations/symphony-logs.js";
import { registerSymphonyPlanRoutes } from "./operations/symphony-plan.js";
import { registerSymphonySessionRoutes } from "./operations/symphony-sessions.js";
import { registerSymphonyStatusRoutes } from "./operations/symphony-status.js";
import { registerSymphonyInteractiveRoutes } from "./operations/symphony-interactive.js";
import { registerSymphonyUploadRoutes } from "./operations/symphony-upload.js";
import { registerTerminalChatRoutes } from "./operations/terminal-chat.js";
import { registerTicketChatRoutes } from "./operations/ticket-chat.js";
import { ProcessManager } from "./process-manager.js";
import { SymphonyDirNotConfiguredError } from "./operations/symphony-utils.js";

export interface GatewayRouterOptions {
  webAppOrigin: string;
  machineName: string;
  version: string;
  capabilities: ComputeTargetCapabilities;
  getActivePort: () => number;
  getAllowedDirectories: () => string[];
  getSymphonyDir?: () => string;
  fallbackEngineerOrigin?: string;
  onActivityEvent?: (event: GatewayActivityEvent) => void;
  getGatewayAuthToken?: () => string;
  evaluateApproval?: (
    request: GatewayApprovalRequest
  ) => GatewayApprovalResult | Promise<GatewayApprovalResult>;
  sessionStore?: LocalSessionStore;
  getApiKey?: () => string | null;
  getApiOrigin?: () => string;
}

export interface GatewayActivityEvent {
  type: "request" | "security";
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  detail?: string;
  requestBody?: string;
  responseBody?: string;
}

export interface GatewayApprovalRequest {
  method: string;
  path: string;
  body: string;
  origin: string | null;
  referer: string | null;
  userAgent: string | null;
  remoteAddress: string | null;
  source: string | null;
  forceApproval: boolean;
  approvalReason: string | null;
}

export type GatewayApprovalResult =
  | { allow: true }
  | { allow: false; statusCode: number; payload: Record<string, unknown> };

export class GatewayRouter {
  private readonly options: GatewayRouterOptions;
  private readonly operationDispatcher: OperationDispatcher;
  private readonly processManager: ProcessManager;

  constructor(options: GatewayRouterOptions, operationDispatcher = new OperationDispatcher()) {
    this.options = options;
    this.operationDispatcher = operationDispatcher;
    this.processManager = new ProcessManager({
      getAllowedDirectories: this.options.getAllowedDirectories
    });
    const getSymphonyDir = this.options.getSymphonyDir ?? (() => { throw new SymphonyDirNotConfiguredError(); });
    registerFilesystemDirectoriesRoutes(
      this.operationDispatcher,
      this.options.getAllowedDirectories
    );
    registerCodexRoutes(this.operationDispatcher, this.options.getAllowedDirectories);
    registerDeployRoutes(this.operationDispatcher, this.options.getAllowedDirectories, getSymphonyDir);
    registerFilesystemSearchRoutes(this.operationDispatcher, this.options.getAllowedDirectories);
    registerGitActionRoutes(
      this.operationDispatcher,
      this.processManager,
      this.options.getAllowedDirectories
    );
    registerGitBranchesRoutes(
      this.operationDispatcher,
      this.processManager,
      this.options.getAllowedDirectories
    );
    registerGitDiffRoutes(
      this.operationDispatcher,
      this.processManager,
      this.options.getAllowedDirectories
    );
    registerGitPrRoutes(this.operationDispatcher, this.options.getAllowedDirectories);
    registerGitWorktreeRoutes(
      this.operationDispatcher,
      this.processManager,
      this.options.getAllowedDirectories,
      getSymphonyDir
    );
    registerHealthCheckRoutes(this.operationDispatcher, this.processManager, getSymphonyDir);
    registerLearningsRoutes(this.operationDispatcher, this.options.getAllowedDirectories);
    registerMetadataRoutes(this.operationDispatcher, this.options.getAllowedDirectories, getSymphonyDir);
    registerReposConfigRoutes(this.operationDispatcher, getSymphonyDir);
    registerRunViewerChatRoutes(
      this.operationDispatcher,
      this.processManager,
      this.options.getAllowedDirectories,
      getSymphonyDir
    );
    registerRunViewerExtractRoutes(this.operationDispatcher);
    registerSymphonyAttachmentsRoutes(
      this.operationDispatcher,
      this.options.getAllowedDirectories
    );
    registerSymphonyChatHistoryRoutes(
      this.operationDispatcher,
      this.options.getAllowedDirectories
    );
    registerSymphonyJudgesRoutes(this.operationDispatcher, this.options.getAllowedDirectories);
    registerSymphonyKillRoutes(this.operationDispatcher, this.options.getAllowedDirectories);
    registerSymphonyLogsRoutes(this.operationDispatcher, this.options.getAllowedDirectories);
    registerSymphonyPlanRoutes(this.operationDispatcher, this.options.getAllowedDirectories);
    registerSymphonySessionRoutes(this.operationDispatcher, this.options.getAllowedDirectories, getSymphonyDir);
    registerSymphonyStatusRoutes(this.operationDispatcher, this.options.getAllowedDirectories);
    registerSymphonyInteractiveRoutes(
      this.operationDispatcher,
      this.options.getAllowedDirectories
    );
    registerSymphonyUploadRoutes(this.operationDispatcher, this.options.getAllowedDirectories);
    registerTerminalChatRoutes(
      this.operationDispatcher,
      this.processManager,
      this.options.getAllowedDirectories,
      getSymphonyDir
    );
    registerTicketChatRoutes(
      this.operationDispatcher,
      this.processManager,
      this.options.getAllowedDirectories,
      getSymphonyDir
    );
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.applyCorsHeaders(request, response);

    const method = request.method?.toUpperCase() ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");
    const isEngineerRoute = url.pathname.startsWith("/api/engineer/");
    const isExchangeRoute = method === "POST" && url.pathname === "/gateway-auth/exchange";
    const startedAt = Date.now();
    let activityType: GatewayActivityEvent["type"] = "request";
    let activityDetail: string | undefined;
    let capturedRequestBody: string | undefined;
    let capturedResponseBody = "";

    if ((isEngineerRoute || isExchangeRoute) && method !== "OPTIONS") {
      const origWrite = response.write;
      const origEnd = response.end;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (response as any).write = function (chunk: any, ...rest: any[]) {
        if (chunk != null) {
          const s =
            typeof chunk === "string"
              ? chunk
              : Buffer.isBuffer(chunk)
                ? chunk.toString("utf-8")
                : "";
          capturedResponseBody += s;
        }
        return origWrite.apply(response, [chunk, ...rest] as any);
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (response as any).end = function (chunk: any, ...rest: any[]) {
        if (chunk != null && typeof chunk !== "function") {
          const s =
            typeof chunk === "string"
              ? chunk
              : Buffer.isBuffer(chunk)
                ? chunk.toString("utf-8")
                : "";
          capturedResponseBody += s;
        }
        return origEnd.apply(response, [chunk, ...rest] as any);
      };

      response.once("finish", () => {
        this.options.onActivityEvent?.({
          type: activityType,
          timestamp: new Date(startedAt).toISOString(),
          method,
          path: url.pathname + url.search,
          statusCode: response.statusCode,
          durationMs: Math.max(0, Date.now() - startedAt),
          detail: activityDetail,
          requestBody: capturedRequestBody,
          responseBody: capturedResponseBody || undefined
        });
      });
    }

    if (method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (isExchangeRoute) {
      const exchangeResult = await this.handleExchange(request, response);
      if (exchangeResult) {
        activityType = exchangeResult.activityType;
        activityDetail = exchangeResult.activityDetail;
      }
      return;
    }

    const authResult = this.isAuthorizedEngineerRequest(request);
    if (isEngineerRoute && !authResult.authorized) {
      activityType = "security";
      activityDetail = authResult.reason ?? "unauthorized";
      response.statusCode = 401;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: "unauthorized", reason: authResult.reason }));
      return;
    }

    if (method === "GET" && url.pathname === "/health") {
      const health: HealthResponse = {
        status: "ok",
        machineName: this.options.machineName,
        capabilities: this.options.capabilities,
        version: this.options.version,
        port: this.options.getActivePort()
      };
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(health));
      return;
    }

    if (isEngineerRoute) {
      const rawBody = await this.readBody(request);
      const body = rawBody.toString("utf-8");
      capturedRequestBody = body || undefined;

      const approval = this.options.evaluateApproval?.({
        method,
        path: url.pathname,
        body,
        origin: request.headers.origin ?? null,
        referer: request.headers.referer ?? null,
        userAgent: firstHeaderValue(request.headers["user-agent"]),
        remoteAddress: request.socket.remoteAddress ?? null,
        source: firstHeaderValue(request.headers["x-desktop-source"]),
        forceApproval: parseBooleanHeader(request.headers["x-desktop-force-approval"]),
        approvalReason: firstHeaderValue(request.headers["x-desktop-approval-reason"])
      });
      const resolvedApproval = approval ? await approval : null;
      if (resolvedApproval && !resolvedApproval.allow) {
        activityDetail = typeof resolvedApproval.payload?.error === "string"
          ? resolvedApproval.payload.error
          : "request not approved";
        response.statusCode = resolvedApproval.statusCode;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(resolvedApproval.payload));
        return;
      }

      const handled = await this.operationDispatcher.dispatch({
        method,
        pathname: url.pathname,
        params: {},
        query: url.searchParams,
        rawBody,
        body,
        request,
        response
      });
      if (handled) {
        return;
      }

      if (this.options.fallbackEngineerOrigin) {
        await this.proxyToFallback(request, response, url.pathname + url.search, rawBody);
        return;
      }

      response.statusCode = 501;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          error: "operation not implemented",
          method,
          path: url.pathname
        })
      );
      return;
    }

    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "route not found" }));
  }

  private applyCorsHeaders(request: IncomingMessage, response: ServerResponse): void {
    const requestOrigin = firstHeaderValue(request.headers.origin);
    response.setHeader(
      "Access-Control-Allow-Origin",
      resolveCorsAllowOrigin(requestOrigin, this.options.webAppOrigin)
    );
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,X-Desktop-Gateway-Token,X-Desktop-Session-Token,X-Desktop-Source,X-Desktop-Force-Approval,X-Desktop-Approval-Reason"
    );
    response.setHeader("Access-Control-Allow-Credentials", "false");
    response.setHeader(
      "Vary",
      "Origin,Access-Control-Request-Headers,Access-Control-Request-Private-Network"
    );

    const privateNetworkRequest = firstHeaderValue(
      request.headers["access-control-request-private-network"]
    );
    if (privateNetworkRequest?.toLowerCase() === "true") {
      response.setHeader("Access-Control-Allow-Private-Network", "true");
    }
  }

  private isAuthorizedEngineerRequest(
    request: IncomingMessage
  ): { authorized: true } | { authorized: false; reason: string } {
    const expectedToken = this.options.getGatewayAuthToken?.();
    if (!expectedToken) {
      return { authorized: true };
    }

    // Path 1: Internal cloud executor token (unchanged)
    const providedGatewayToken = firstHeaderValue(request.headers["x-desktop-gateway-token"]);
    if (providedGatewayToken && safeEqualToken(providedGatewayToken, expectedToken)) {
      return { authorized: true };
    }

    // Path 2: Browser session token with origin validation
    const sessionStore = this.options.sessionStore;
    const sessionToken = firstHeaderValue(request.headers["x-desktop-session-token"]);
    const requestOrigin = firstHeaderValue(request.headers.origin);

    if (sessionToken) {
      if (!requestOrigin || requestOrigin === "null") {
        return { authorized: false, reason: "session token present but Origin header missing" };
      }
      if (!sessionStore) {
        return { authorized: false, reason: "session store not configured" };
      }
      if (sessionStore.validate(sessionToken, requestOrigin)) {
        return { authorized: true };
      }
      return { authorized: false, reason: "invalid or expired session token, or origin mismatch" };
    }

    // No valid credential provided
    if (!requestOrigin || requestOrigin === "null") {
      return { authorized: false, reason: "no credential provided" };
    }
    return { authorized: false, reason: "session token required for browser requests" };
  }

  private async handleExchange(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<{ activityType: GatewayActivityEvent["type"]; activityDetail: string } | null> {
    const requestOrigin = firstHeaderValue(request.headers.origin);

    if (!requestOrigin || requestOrigin === "null") {
      response.statusCode = 400;
      response.setHeader("content-type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      response.end(JSON.stringify({ error: "Origin header required" }));
      return null;
    }

    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      response.statusCode = 403;
      response.setHeader("content-type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      response.end(JSON.stringify({ error: "loopback only" }));
      return { activityType: "security", activityDetail: "exchange rejected: non-loopback origin" };
    }

    const apiKey = this.options.getApiKey?.();
    if (!apiKey) {
      response.statusCode = 503;
      response.setHeader("content-type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      response.end(JSON.stringify({ error: "Local gateway auth unavailable: API key required" }));
      return null;
    }

    const apiOrigin = this.options.getApiOrigin?.();
    if (!apiOrigin) {
      response.statusCode = 503;
      response.setHeader("content-type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      response.end(JSON.stringify({ error: "API origin not configured" }));
      return null;
    }

    const rawBody = await this.readBody(request);
    let challengeToken: string;
    try {
      const parsed = JSON.parse(rawBody.toString("utf-8")) as Record<string, unknown>;
      if (typeof parsed.challengeToken !== "string" || !parsed.challengeToken) {
        throw new Error("missing challengeToken");
      }
      challengeToken = parsed.challengeToken;
    } catch {
      response.statusCode = 400;
      response.setHeader("content-type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      response.end(JSON.stringify({ error: "invalid request body: challengeToken required" }));
      return null;
    }

    const userAgent = firstHeaderValue(request.headers["user-agent"]) ?? undefined;
    const result = await verifyChallenge({
      challengeToken,
      requestOrigin,
      userAgent,
      apiOrigin,
      apiKey,
    });

    if (!result.ok) {
      const statusCode = result.statusCode ?? 401;
      response.statusCode = statusCode;
      response.setHeader("content-type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      response.end(JSON.stringify({ error: result.error }));
      return { activityType: "security", activityDetail: `exchange rejected: ${result.error}` };
    }

    const sessionStore = this.options.sessionStore;
    if (!sessionStore) {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      response.end(JSON.stringify({ error: "session store not available" }));
      return null;
    }

    const session = sessionStore.create(requestOrigin, result.sessionTtlSeconds);

    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify({
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
    }));
    return null;
  }

  private async readBody(request: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }

    if (chunks.length === 0) {
      return Buffer.alloc(0);
    }

    return Buffer.concat(chunks);
  }

  private async proxyToFallback(
    request: IncomingMessage,
    response: ServerResponse,
    requestPath: string,
    rawBody: Buffer
  ): Promise<void> {
    const targetUrl = new URL(requestPath, this.options.fallbackEngineerOrigin);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (!value) {
        continue;
      }
      if (name.toLowerCase() === "host") {
        continue;
      }
      if (Array.isArray(value)) {
        headers.set(name, value.join(", "));
      } else {
        headers.set(name, value);
      }
    }

    const method = request.method?.toUpperCase() ?? "GET";
    const upstreamResponse = await fetch(targetUrl, {
      method,
      headers,
      body:
        method === "GET" || method === "HEAD" ? undefined : new Uint8Array(rawBody)
    });

    response.statusCode = upstreamResponse.status;
    for (const [name, value] of upstreamResponse.headers) {
      if (name.toLowerCase() === "access-control-allow-origin") {
        continue;
      }
      response.setHeader(name, value);
    }

    if (!upstreamResponse.body) {
      response.end();
      return;
    }

    const reader = upstreamResponse.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      response.write(Buffer.from(value));
    }
    response.end();
  }
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value;
}

function parseBooleanHeader(value: string | string[] | undefined): boolean {
  const first = firstHeaderValue(value);
  if (!first) {
    return false;
  }
  return first === "1" || first.toLowerCase() === "true";
}

function safeEqualToken(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) {
    return false;
  }

  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function isLoopbackOrigin(originValue: string): boolean {
  try {
    const parsed = new URL(originValue);
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname === "[::1]" ||
      parsed.hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

function resolveCorsAllowOrigin(
  requestOrigin: string | null,
  configuredWebAppOrigin: string
): string {
  if (!requestOrigin) {
    return configuredWebAppOrigin;
  }
  if (requestOrigin === "null") {
    return configuredWebAppOrigin;
  }
  if (sameOrigin(requestOrigin, configuredWebAppOrigin)) {
    return requestOrigin;
  }
  if (isLoopbackOrigin(requestOrigin)) {
    return requestOrigin;
  }
  return configuredWebAppOrigin;
}


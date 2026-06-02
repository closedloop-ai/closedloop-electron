import http from "node:http";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { AGENT_MONITOR_PORT } from "../shared/contracts.js";
import { isSessionInSandbox } from "./agent-session-sync-service.js";
import type { createLifecycle, HookData } from "./database/lifecycle.js";

// CLOSEDLOOP-TICKET FEA-1500: remove legacy HTTP hook listener on 4820 after
// transport migration (FEA-1497 breaking-change discipline contract #1). The hook
// commands baked into ~/.claude/settings.json and ~/.codex/hooks.json POST to
// 127.0.0.1:4820/api/hooks/event; this in-process listener replaces the vendor
// sidecar that previously owned that port. The contract (port, path, payload
// envelope) MUST stay backward-compatible until all installs self-heal to a
// lighter transport.

const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 8 * 1024 * 1024; // hook payloads (incl. large tool_input) cap

/** The `{ hook_type, data }` envelope every hook handler POSTs. */
const HookEnvelopeSchema = z.object({
  hook_type: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export interface AgentHookListenerOptions {
  /** The lifecycle processor that owns all DB writes. */
  lifecycle: ReturnType<typeof createLifecycle>;
  /** FEA-1407 sandbox base directory (empty string ⇒ capture nothing). */
  getSandboxBaseDirectory: () => string;
  /** Key-free diagnostic sink (gatewayLog). */
  log?: (message: string) => void;
  /**
   * Called when the listener cannot bind its port (e.g. EADDRINUSE from a stale
   * process). Lets the host surface a degraded indicator; capture stays off for
   * the session rather than crashing boot.
   */
  onBindError?: (reason: string) => void;
  /** Override for tests; defaults to AGENT_MONITOR_PORT (4820). */
  port?: number;
}

/**
 * First-party in-process replacement for the vendor agent-monitor sidecar's
 * HTTP receiver. Binds `127.0.0.1:4820` and accepts the unchanged hook payload
 * contract:
 *   - `GET  /api/health`      → 200 `{ ok: true }`
 *   - `POST /api/hooks/event` → `{ hook_type, data }`, snake_case `data`.
 *
 * Every request responds 200 fail-soft so a hook never blocks an agent turn.
 * FEA-1407 sandbox gating is enforced BEFORE any DB write — with no sandbox
 * configured, nothing is captured (fail-closed; do not ungate — defense in
 * depth so out-of-sandbox sessions never enter the local DB).
 */
export class AgentHookListener {
  private readonly options: AgentHookListenerOptions;
  private readonly port: number;
  private boundPort: number | null = null;
  private server: http.Server | null = null;
  private ready = false;

  constructor(options: AgentHookListenerOptions) {
    this.options = options;
    this.port = options.port ?? AGENT_MONITOR_PORT;
  }

  isReady(): boolean {
    return this.ready;
  }

  getUrl(): string | null {
    return this.ready && this.boundPort != null
      ? `http://${HOST}:${this.boundPort}`
      : null;
  }

  /**
   * Start the listener. Fire-and-forget: a bind failure (e.g. EADDRINUSE from a
   * stale process) is logged and degrades to "no listener" rather than blocking
   * boot or throwing.
   */
  start(): Promise<void> {
    if (this.server) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });
      server.on("error", (error: NodeJS.ErrnoException) => {
        this.ready = false;
        const reason =
          error.code === "EADDRINUSE"
            ? `Agent capture port ${this.port} is already in use; agent monitoring is off this session.`
            : `Agent hook listener error: ${error.message}`;
        this.log(reason);
        this.options.onBindError?.(reason);
        resolve();
      });
      server.listen(this.port, HOST, () => {
        const address = server.address() as AddressInfo | null;
        this.boundPort = address?.port ?? this.port;
        this.ready = true;
        this.log(`agent hook listener ready on http://${HOST}:${this.boundPort}`);
        resolve();
      });
      this.server = server;
    });
  }

  stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.ready = false;
    if (!server) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private log(message: string): void {
    this.options.log?.(message);
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === "GET" && req.url === "/api/health") {
      this.json(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && req.url === "/api/hooks/event") {
      this.handleHookEvent(req, res);
      return;
    }
    this.json(res, 404, { ok: false, error: "not found" });
  }

  private handleHookEvent(req: IncomingMessage, res: ServerResponse): void {
    readBody(req, MAX_BODY_BYTES)
      .then((body) => {
        try {
          const parsed = HookEnvelopeSchema.safeParse(JSON.parse(body));
          if (!parsed.success) {
            // Unknown shape: ack so the hook does not block, but do not write.
            this.json(res, 200, { ok: true, skipped: "invalid" });
            return;
          }
          const { hook_type: hookType, data: rawData } = parsed.data;
          const data = (rawData ?? {}) as HookData;

          // Harness is stamped at the boundary from the transport hint the
          // codex handler injects; everything else is Claude Code.
          const harness = data.__provider === "codex" ? "codex" : "claude";

          // FEA-1407: gate LOCAL capture on the sandbox BEFORE any write. Empty
          // sandbox ⇒ isSessionInSandbox returns false ⇒ nothing is captured.
          const sandboxBase = this.options.getSandboxBaseDirectory();
          const cwd = typeof data.cwd === "string" ? data.cwd : null;
          if (!isSessionInSandbox(cwd, sandboxBase)) {
            this.json(res, 200, { ok: true, skipped: "out-of-sandbox" });
            return;
          }

          this.options.lifecycle.processEvent(hookType, data, harness);
          this.json(res, 200, { ok: true });
        } catch (error) {
          // Malformed JSON or unexpected error: ack 200 (fail-soft) + log.
          this.log(
            `agent hook listener: failed to handle event: ${error instanceof Error ? error.message : String(error)}`,
          );
          this.json(res, 200, { ok: false });
        }
      })
      .catch(() => {
        this.json(res, 200, { ok: false });
      });
  }

  private json(res: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
  }
}

/** Read a request body to a string, rejecting payloads over `maxBytes`. */
function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

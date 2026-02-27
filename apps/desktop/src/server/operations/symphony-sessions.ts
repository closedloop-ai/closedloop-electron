import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OperationDispatcher } from "../operation-dispatcher.js";
import type { OperationRequestContext } from "../operation-dispatcher.js";
import { DirectoryNotAllowedError, assertPathAllowed } from "../security.js";

type ActiveSession = {
  ticketId: string;
  repoPath: string;
  worktreePath: string;
  pid?: number;
  contextRepoPaths?: string[];
  baseBranch?: string;
  parentTicketId?: string;
  startedAt: string;
  lastAccessedAt: string;
};

type SessionsConfig = {
  sessions: ActiveSession[];
};

export function registerSymphonySessionRoutes(
  dispatcher: OperationDispatcher,
  getAllowedDirectories: () => string[]
): void {
  dispatcher.register("GET", "/api/engineer/symphony/sessions", async (context) => {
    const config = await loadSessions();

    const validSessions = config.sessions.filter((session) => {
      const expandedWorktreePath = expandHome(session.worktreePath);
      return existsSync(expandedWorktreePath);
    });

    if (validSessions.length !== config.sessions.length) {
      await saveSessions({ sessions: validSessions });
    }

    json(context, 200, { sessions: validSessions });
  });

  dispatcher.register("POST", "/api/engineer/symphony/sessions", async (context) => {
    const body = parseBody(context);
    if (!body) {
      json(context, 400, { error: "Invalid JSON body" });
      return;
    }

    const ticketId = typeof body.ticketId === "string" ? body.ticketId : null;
    const repoPath = typeof body.repoPath === "string" ? body.repoPath : null;
    const worktreePath = typeof body.worktreePath === "string" ? body.worktreePath : null;
    const pid = typeof body.pid === "number" ? body.pid : undefined;
    const contextRepoPaths =
      Array.isArray(body.contextRepoPaths) && body.contextRepoPaths.every((item) => typeof item === "string")
        ? body.contextRepoPaths
        : undefined;
    const baseBranch = typeof body.baseBranch === "string" ? body.baseBranch : undefined;
    const parentTicketId = typeof body.parentTicketId === "string" ? body.parentTicketId : undefined;

    if (!(ticketId && repoPath && worktreePath)) {
      json(context, 400, { error: "ticketId, repoPath, and worktreePath are required" });
      return;
    }

    try {
      const allowedDirectories = getAllowedDirectories();
      assertPathAllowed(expandHome(repoPath), allowedDirectories);
      assertPathAllowed(expandHome(worktreePath), allowedDirectories);
      if (Array.isArray(contextRepoPaths)) {
        for (const contextRepoPath of contextRepoPaths) {
          assertPathAllowed(expandHome(contextRepoPath), allowedDirectories);
        }
      }
    } catch (error) {
      if (error instanceof DirectoryNotAllowedError) {
        json(context, 403, { error: "directory not allowed" });
        return;
      }
      throw error;
    }

    const config = await loadSessions();
    const now = new Date().toISOString();
    const existingIndex = config.sessions.findIndex((session) => session.ticketId === ticketId);

    if (existingIndex >= 0) {
      config.sessions[existingIndex] = {
        ...config.sessions[existingIndex],
        repoPath,
        worktreePath,
        ...(pid !== undefined && { pid }),
        ...(contextRepoPaths !== undefined && { contextRepoPaths }),
        ...(baseBranch !== undefined && { baseBranch }),
        ...(parentTicketId !== undefined && { parentTicketId }),
        lastAccessedAt: now
      };
    } else {
      config.sessions.push({
        ticketId,
        repoPath,
        worktreePath,
        ...(pid !== undefined && { pid }),
        ...(contextRepoPaths !== undefined && { contextRepoPaths }),
        ...(baseBranch !== undefined && { baseBranch }),
        ...(parentTicketId !== undefined && { parentTicketId }),
        startedAt: now,
        lastAccessedAt: now
      });
    }

    await saveSessions(config);
    json(context, 200, { success: true });
  });

  dispatcher.register("DELETE", "/api/engineer/symphony/sessions", async (context) => {
    const ticketId = context.query.get("ticketId");
    if (!ticketId) {
      json(context, 400, { error: "ticketId parameter is required" });
      return;
    }

    const config = await loadSessions();
    config.sessions = config.sessions.filter((session) => session.ticketId !== ticketId);
    await saveSessions(config);
    json(context, 200, { success: true });
  });
}

function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(getSymphonyDir(), { recursive: true });
}

async function loadSessions(): Promise<SessionsConfig> {
  await ensureDir();
  const sessionsFile = getSessionsFile();

  if (!existsSync(sessionsFile)) {
    return { sessions: [] };
  }

  try {
    const content = await fs.readFile(sessionsFile, "utf-8");
    const parsed = JSON.parse(content) as SessionsConfig;
    if (!Array.isArray(parsed.sessions)) {
      return { sessions: [] };
    }
    return parsed;
  } catch {
    return { sessions: [] };
  }
}

async function saveSessions(config: SessionsConfig): Promise<void> {
  await ensureDir();
  await fs.writeFile(getSessionsFile(), JSON.stringify(config, null, 2), "utf-8");
}

function parseBody(context: OperationRequestContext): Record<string, unknown> | null {
  if (!context.body.trim()) {
    return {};
  }

  try {
    return JSON.parse(context.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function json(context: OperationRequestContext, status: number, payload: unknown): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}

function getSymphonyDir(): string {
  const overrideDirectory = process.env.SYMPHONY_HOME_DIR;
  if (overrideDirectory && overrideDirectory.trim()) {
    return path.resolve(overrideDirectory);
  }
  return path.join(os.homedir(), ".symphony");
}

function getSessionsFile(): string {
  return path.join(getSymphonyDir(), "sessions.json");
}

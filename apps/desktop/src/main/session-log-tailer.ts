/**
 * Session-log tailer for FEA-1226 (Engineer GitHub Activity Capture).
 *
 * Watches Claude Code (`~/.claude/projects/`) and Codex (`~/.codex/sessions/`)
 * JSONL session files. Dispatches each new line through three parsers and
 * adds resulting events to the GitActivityStore. Only runs when the user has
 * enabled `captureEngineerActivity` in Settings.
 *
 * Design notes:
 *   - `fs.watch` recursive on each root, debounced per-file. Macros (kernel
 *     coalescing) means a burst of writes lands as one or two events; 500 ms
 *     debounce smooths that out.
 *   - Per-file byte offset map so we only re-read the new tail. Lost on
 *     restart — dedup via event id absorbs any duplicate work.
 *   - Initial scan processes only files modified within INITIAL_SCAN_DAYS so
 *     toggling capture on doesn't backscan years of history.
 *   - Missing watch roots are logged and skipped. The tailer is best-effort
 *     and never throws into the boot path.
 */

import { promises as fsp } from "node:fs";
import { watch as fsWatch } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GitActivityStore } from "./git-activity-store.js";
import { gatewayLog } from "./gateway-logger.js";
import {
  createClaudeCodeParserState,
  parseClaudeCodeLine,
  parseClosedloopLoopLine,
  parseCodexLine,
  safeParseLine,
  type ClaudeCodeParserState,
} from "./session-log-parsers.js";

const TAG = "git-activity-tailer";
const DEFAULT_DEBOUNCE_MS = 500;
const INITIAL_SCAN_DAYS = 30;
const PARTIAL_LINE_MAX_BYTES = 1 << 20; // 1 MiB safety bound for unflushed lines

export interface SessionLogTailerOptions {
  store: GitActivityStore;
  /** Defaults to `~/.claude/projects` (override via `CLAUDE_PROJECTS_DIR`). */
  claudeProjectsDir?: string;
  /** Defaults to `$CODEX_HOME/sessions` or `~/.codex/sessions`. */
  codexSessionsDir?: string;
  /** Debounce interval per file (ms). Lower in tests. */
  debounceMs?: number;
  /** Days of history scanned at startup. Older files are skipped (offset set to file end). */
  initialScanDays?: number;
}

export class SessionLogTailer {
  private readonly store: GitActivityStore;
  private readonly claudeDir: string;
  private readonly codexDir: string;
  private readonly debounceMs: number;
  private readonly initialScanCutoffMs: number;

  private readonly offsets = new Map<string, number>();
  private readonly claudeStates = new Map<string, ClaudeCodeParserState>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly watcherAborts: AbortController[] = [];
  private started = false;

  constructor(opts: SessionLogTailerOptions) {
    this.store = opts.store;
    this.claudeDir = opts.claudeProjectsDir ?? defaultClaudeProjectsDir();
    this.codexDir = opts.codexSessionsDir ?? defaultCodexSessionsDir();
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    const days = opts.initialScanDays ?? INITIAL_SCAN_DAYS;
    this.initialScanCutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    gatewayLog.info(
      TAG,
      `start (claude=${this.claudeDir}, codex=${this.codexDir})`,
    );
    await Promise.all([
      this.attach(this.claudeDir),
      this.attach(this.codexDir),
    ]);
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.started = false;
    for (const ac of this.watcherAborts.splice(0)) {
      ac.abort();
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    gatewayLog.info(TAG, "stop");
  }

  /** Test hook — flush all pending debounce timers immediately. */
  async flushForTesting(): Promise<void> {
    const filePaths = [...this.debounceTimers.keys()];
    for (const filePath of filePaths) {
      const timer = this.debounceTimers.get(filePath);
      if (timer) {
        clearTimeout(timer);
      }
      this.debounceTimers.delete(filePath);
      await this.processFile(filePath);
    }
  }

  private async attach(root: string): Promise<void> {
    const exists = await directoryExists(root);
    if (!exists) {
      gatewayLog.info(TAG, `watch root missing, skipping: ${root}`);
      return;
    }
    await this.initialScan(root);
    const ac = new AbortController();
    this.watcherAborts.push(ac);
    // The watcher loop runs detached. Aborting via the AbortController causes
    // the for-await to throw, which we catch silently.
    void this.runWatcher(root, ac.signal);
  }

  private async runWatcher(root: string, signal: AbortSignal): Promise<void> {
    try {
      const watcher = fsWatch(root, { recursive: true, signal });
      for await (const event of watcher) {
        if (!event.filename) {
          continue;
        }
        if (!event.filename.endsWith(".jsonl")) {
          continue;
        }
        const filePath = path.join(root, event.filename);
        this.scheduleProcess(filePath);
      }
    } catch (err) {
      if (signal.aborted) {
        return; // expected on stop()
      }
      gatewayLog.warn(
        TAG,
        `watcher for ${root} ended: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async initialScan(root: string): Promise<void> {
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop()!;
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          await this.maybeProcessInitial(full);
        }
      }
    }
  }

  private async maybeProcessInitial(filePath: string): Promise<void> {
    let stat: import("node:fs").Stats;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      return;
    }
    if (stat.mtimeMs < this.initialScanCutoffMs) {
      // File is older than the scan window. Set offset to current end so
      // future writes (if any) are picked up but the history is not replayed.
      this.offsets.set(filePath, stat.size);
      return;
    }
    await this.processFile(filePath);
  }

  private scheduleProcess(filePath: string): void {
    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.processFile(filePath).catch((err) => {
        gatewayLog.warn(
          TAG,
          `processFile ${filePath} threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, this.debounceMs);
    // Node.js Timeout.unref() — don't keep the event loop alive for these
    timer.unref?.();
    this.debounceTimers.set(filePath, timer);
  }

  private async processFile(filePath: string): Promise<void> {
    let stat: import("node:fs").Stats;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      // file vanished
      this.offsets.delete(filePath);
      this.claudeStates.delete(filePath);
      return;
    }
    const offset = this.offsets.get(filePath) ?? 0;
    if (stat.size <= offset) {
      // truncation or no new bytes; reset if file shrank
      if (stat.size < offset) {
        this.offsets.set(filePath, stat.size);
      }
      return;
    }
    const length = stat.size - offset;
    if (length > PARTIAL_LINE_MAX_BYTES * 64) {
      // safety cap — skip absurdly large chunks (likely a misuse / massive file)
      gatewayLog.warn(
        TAG,
        `skipping ${filePath}: too many new bytes (${length})`,
      );
      this.offsets.set(filePath, stat.size);
      return;
    }
    const fh = await fsp.open(filePath, "r");
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, offset);
      const slice = buf.subarray(0, bytesRead);
      const text = slice.toString("utf-8");
      const sessionId = path.basename(filePath, ".jsonl");
      let state = this.claudeStates.get(filePath);
      if (!state) {
        state = createClaudeCodeParserState();
        this.claudeStates.set(filePath, state);
      }
      const { processedBytes } = this.processChunk(text, sessionId, state);
      this.offsets.set(filePath, offset + processedBytes);
    } finally {
      await fh.close();
    }
  }

  /**
   * Splits a chunk on '\n' and dispatches complete lines. The trailing
   * partial line (if any) is left for the next pass — `processedBytes`
   * indicates how many bytes were actually consumed.
   */
  private processChunk(
    text: string,
    sessionId: string,
    state: ClaudeCodeParserState,
  ): { processedBytes: number } {
    if (text.length === 0) {
      return { processedBytes: 0 };
    }
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline === -1) {
      // No complete line in the chunk yet. Defer all of it.
      return { processedBytes: 0 };
    }
    const complete = text.slice(0, lastNewline);
    const lines = complete.split("\n");
    for (const line of lines) {
      if (line.length === 0) {
        continue;
      }
      this.dispatchLine(line, sessionId, state);
    }
    const processedBytes = Buffer.byteLength(complete, "utf-8") + 1; // +1 for the \n
    return { processedBytes };
  }

  private dispatchLine(
    line: string,
    sessionId: string,
    state: ClaudeCodeParserState,
  ): void {
    const parsed = safeParseLine(line);
    if (!parsed) {
      return;
    }
    const inputs = [
      ...parseClosedloopLoopLine(parsed, sessionId),
      ...parseCodexLine(parsed, sessionId),
      ...parseClaudeCodeLine(parsed, sessionId, state),
    ];
    for (const input of inputs) {
      this.store.add(input);
    }
  }
}

function defaultClaudeProjectsDir(): string {
  if (process.env.CLAUDE_PROJECTS_DIR) {
    return process.env.CLAUDE_PROJECTS_DIR;
  }
  return path.join(os.homedir(), ".claude", "projects");
}

function defaultCodexSessionsDir(): string {
  if (process.env.CODEX_HOME) {
    return path.join(process.env.CODEX_HOME, "sessions");
  }
  return path.join(os.homedir(), ".codex", "sessions");
}

async function directoryExists(p: string): Promise<boolean> {
  try {
    const s = await fsp.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

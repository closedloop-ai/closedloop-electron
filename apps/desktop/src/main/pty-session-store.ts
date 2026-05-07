import {
  createWriteStream,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  type WriteStream,
} from "node:fs";
import pty, { type IPty } from "node-pty";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnSessionOpts {
  loopId: string;
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  logFile: string;
  /** If set, JSON lines from stdout are extracted and written to this file
   *  (replaces the bash grep/tee pipeline for JSONL capture). */
  jsonlFile?: string;
  cols?: number;
  rows?: number;
}

export interface PtySession {
  loopId: string;
  pty: IPty;
  pid: number;
  logStream: WriteStream;
  outputBuffer: string;
  exited: boolean;
  exitCode: number | null;
  dataListeners: Set<(data: string) => void>;
  exitListeners: Set<(info: { exitCode: number }) => void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum size of the in-memory replay ring buffer (200 KB). */
const MAX_BUFFER_SIZE = 200 * 1024;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const sessions = new Map<string, PtySession>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function spawnPtySession(opts: SpawnSessionOpts): PtySession {
  // Validate log file is writable before spawning (fails fast on EISDIR, EACCES, etc.)
  const logFd = openSync(opts.logFile, "a");
  closeSync(logFd);
  const logStream = createWriteStream(opts.logFile, { flags: "a" });
  const jsonlStream = opts.jsonlFile
    ? createWriteStream(opts.jsonlFile, { flags: "a" })
    : null;
  // Buffer for accumulating partial lines to extract JSON from PTY output
  let jsonlLineBuf = "";

  const ptyProcess = pty.spawn(opts.file, opts.args, {
    name: "xterm-256color",
    cols: opts.cols ?? 120,
    rows: opts.rows ?? 40,
    cwd: opts.cwd,
    env: opts.env,
  });

  const session: PtySession = {
    loopId: opts.loopId,
    pty: ptyProcess,
    pid: ptyProcess.pid,
    logStream,
    outputBuffer: "",
    exited: false,
    exitCode: null,
    dataListeners: new Set(),
    exitListeners: new Set(),
  };

  // Tee output to log file + ring buffer + JSONL extraction + subscribers
  ptyProcess.onData((data: string) => {
    // Write to log file
    logStream.write(data);

    // Extract JSON lines for JSONL file (replaces grep '^{' | tee pipeline)
    if (jsonlStream) {
      jsonlLineBuf += data;
      const lines = jsonlLineBuf.split("\n");
      // Keep last partial line in buffer
      jsonlLineBuf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("{")) {
          jsonlStream.write(trimmed + "\n");
        }
      }
    }

    // Append to ring buffer, trim if exceeds max
    session.outputBuffer += data;
    if (session.outputBuffer.length > MAX_BUFFER_SIZE) {
      session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER_SIZE);
    }

    // Notify subscribers
    for (const listener of session.dataListeners) {
      try {
        listener(data);
      } catch {
        // Ignore listener errors
      }
    }
  });

  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    session.exited = true;
    session.exitCode = exitCode;

    // Flush any remaining partial line from the JSONL buffer
    if (jsonlStream) {
      const trimmed = jsonlLineBuf.trim();
      if (trimmed.startsWith("{")) {
        jsonlStream.write(trimmed + "\n");
      }
      jsonlLineBuf = "";
    }

    logStream.end();
    jsonlStream?.end();

    const notifyExitListeners = () => {
      for (const listener of session.exitListeners) {
        try {
          listener({ exitCode });
        } catch {
          // Ignore listener errors
        }
      }
    };

    // After streams close, do a full re-extraction of JSON lines from the
    // session log into the JSONL file. Interactive mode output may contain
    // ANSI sequences and interleaved user input that the real-time extractor
    // missed due to PTY chunking. This complete sweep ensures parseTokenUsage,
    // output-tailer, and error detection have all available structured data.
    // Exit listeners are deferred until extraction completes so that
    // handleProcessCompletion reads the final JSONL content.
    if (opts.jsonlFile && opts.logFile) {
      logStream.once("finish", () => {
        extractJsonlFromLog(opts.logFile, opts.jsonlFile!);
        notifyExitListeners();
      });
    } else {
      notifyExitListeners();
    }
  });

  sessions.set(opts.loopId, session);
  return session;
}

export function getSession(loopId: string): PtySession | undefined {
  return sessions.get(loopId);
}

export function hasSession(loopId: string): boolean {
  return sessions.has(loopId);
}

export function writeToPty(loopId: string, data: string): void {
  const session = sessions.get(loopId);
  if (session && !session.exited) {
    session.pty.write(data);
  }
}

export function resizePty(loopId: string, cols: number, rows: number): void {
  const session = sessions.get(loopId);
  if (session && !session.exited) {
    session.pty.resize(cols, rows);
  }
}

export function killPty(loopId: string): void {
  const session = sessions.get(loopId);
  if (session && !session.exited) {
    session.pty.kill();
  }
}

export function removeSession(loopId: string): void {
  const session = sessions.get(loopId);
  if (session) {
    if (!session.exited) {
      session.pty.kill();
    }
    session.dataListeners.clear();
    session.exitListeners.clear();
    sessions.delete(loopId);
  }
}

// ---------------------------------------------------------------------------
// Post-exit JSONL extraction
// ---------------------------------------------------------------------------

/** Strip ANSI escape sequences so JSON buried in terminal output can be found. */
function stripAnsi(text: string): string {
  return text.replaceAll(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    "",
  );
}

/**
 * Read the full session log, extract every JSON line, and overwrite the JSONL
 * file with the complete set. This catches anything the real-time extractor
 * missed due to PTY chunking or ANSI interleaving in interactive mode.
 */
function extractJsonlFromLog(logFile: string, jsonlFile: string): void {
  try {
    const raw = readFileSync(logFile, "utf-8");
    const cleaned = stripAnsi(raw);
    const extracted: string[] = [];
    for (const line of cleaned.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          JSON.parse(trimmed);
          extracted.push(trimmed);
        } catch {
          // Not valid JSON — skip
        }
      }
    }
    if (extracted.length > 0) {
      writeFileSync(jsonlFile, extracted.join("\n") + "\n");
    }
  } catch {
    // Best effort — don't fail the exit path
  }
}

/**
 * Structured logger for the desktop gateway.
 * All log entries are timestamped, tagged by subsystem, and optionally
 * buffered in-memory so the UI can display recent entries.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  tag: string;
  message: string;
}

const MAX_BUFFER_SIZE = 500;

export class GatewayLogger {
  private verbose = false;
  private readonly buffer: LogEntry[] = [];
  private onChange?: (entries: LogEntry[]) => void;
  private lastMessage = "";

  setVerbose(enabled: boolean): void {
    if (this.verbose === enabled) return;
    this.verbose = enabled;
    this.info("logger", enabled ? "Verbose logging enabled" : "Verbose logging disabled");
  }

  isVerbose(): boolean {
    return this.verbose;
  }

  setOnChange(cb: (entries: LogEntry[]) => void): void {
    this.onChange = cb;
  }

  info(tag: string, message: string): void {
    this.log("info", tag, message);
  }

  warn(tag: string, message: string): void {
    this.log("warn", tag, message);
  }

  error(tag: string, message: string): void {
    this.log("error", tag, message);
  }

  /** Verbose-only log -- skipped when verbose mode is off. */
  debug(tag: string, message: string): void {
    if (!this.verbose) return;
    this.log("info", tag, message);
  }

  getEntries(): LogEntry[] {
    return [...this.buffer];
  }

  clear(): void {
    this.buffer.length = 0;
    this.lastMessage = "";
    this.onChange?.([]);
  }

  private log(level: LogLevel, tag: string, message: string): void {
    const key = `${level}:${tag}:${message}`;
    if (key === this.lastMessage) return;
    this.lastMessage = key;

    const ts = new Date().toISOString();
    const entry: LogEntry = { timestamp: ts, level, tag, message };

    this.buffer.push(entry);
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_SIZE);
    }

    const short = ts.slice(11, 23);
    const prefix = `[${tag}][${short}]`;
    if (level === "error") {
      console.error(prefix, message);
    } else if (level === "warn") {
      console.warn(prefix, message);
    } else {
      console.log(prefix, message);
    }

    this.onChange?.([...this.buffer]);
  }
}

/** Singleton instance shared across the app. */
export const gatewayLog = new GatewayLogger();

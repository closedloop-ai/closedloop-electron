/**
 * @file claude-collector.ts
 * @description Claude Code harness collector descriptor (FEA-1503). Claude is the
 * one harness with a live hook path, so its live file watcher is gated OFF by the
 * CollectorManager whenever hooks are installed (hooks own live capture; a
 * concurrent watcher would double-count turns). Boot historical import always
 * runs and is idempotent against any hook-written events.
 */
import type { HarnessCollector } from "../types.js";
import { getProjectsDir, listAllTranscriptFiles } from "./claude-home.js";
import { parseSessionFile } from "./claude-parser.js";

export function createClaudeCollector(): HarnessCollector {
  return {
    key: "claude",
    cacheName: "claude",
    watchRoots: () => [getProjectsDir()],
    watchMatch: (filename: string) => filename.endsWith(".jsonl"),
    listSources: () => listAllTranscriptFiles(),
    parse: async (filePath: string) => {
      const session = await parseSessionFile(filePath);
      return session ? [session] : [];
    },
  };
}

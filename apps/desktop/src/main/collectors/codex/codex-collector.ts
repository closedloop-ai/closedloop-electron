/**
 * @file codex-collector.ts
 * @description The per-harness collector descriptor for OpenAI Codex (FEA-1503).
 * The generic boot importer and the generic watcher drive Codex through this
 * uniform `HarnessCollector` shape: path/env resolution lives in `codex-home`,
 * format → NormalizedSession in `codex-parser`, and this descriptor wires them
 * together for the collector manager.
 */
import type { HarnessCollector, NormalizedSession } from "../types.js";
import { getCodexSessionsDir, listAllRolloutFiles } from "./codex-home.js";
import { parseRolloutFile } from "./codex-parser.js";

export function createCodexCollector(): HarnessCollector {
  return {
    key: "codex",
    cacheName: "codex",
    watchRoots(): string[] {
      // Recursive watch handled by the caller; Codex nests by date under here.
      return [getCodexSessionsDir()];
    },
    watchMatch(filename: string): boolean {
      return filename.endsWith(".jsonl");
    },
    listSources(): string[] {
      return listAllRolloutFiles();
    },
    async parse(filePath: string): Promise<NormalizedSession[]> {
      const s = await parseRolloutFile(filePath);
      return s ? [s] : [];
    },
  };
}

/**
 * @file collector-manager.ts
 * @description Owns the in-process multi-harness collection layer (FEA-1503):
 * boot-time bulk import + live file watchers for all five agent CLIs (Claude,
 * Codex, Cursor, Copilot, OpenCode), writing through the injected importer into
 * the shared in-process DB. Started/stopped alongside the
 * hook listener via the `agentMonitorEnabled` toggle.
 *
 * Local import is ungated — all sessions from all five harnesses are imported
 * into the local DB regardless of the sandbox directory. Sandbox enforcement
 * is applied exclusively on the cloud-sync path in AgentSessionSyncService.
 *
 * Claude has a live hook path; its live watcher is therefore gated OFF when hooks
 * are installed (hooks own live capture — a concurrent file watcher would
 * double-count turns). Claude boot historical import still runs and is idempotent
 * against any hook-written events.
 */
import type { Importer } from "../agent-dashboard-db-types.js";
import { createCatchupCache, type CatchupCache } from "./catchup-cache.js";
import { ingestCachePath, ingestOpencodeFingerprintPath } from "./ingest-paths.js";
import { createHarnessWatcher, type HarnessWatcher } from "./watcher.js";
import type { HarnessCollector, NormalizedSession } from "./types.js";
import { createClaudeCollector } from "./claude/claude-collector.js";
import { createCodexCollector } from "./codex/codex-collector.js";
import { createCursorCollector } from "./cursor/cursor-collector.js";
import { createCopilotCollector } from "./copilot/copilot-collector.js";
import { createOpencodeCollector } from "./opencode/opencode-collector.js";

export interface CollectorManagerOptions {
  importer: Importer;
  /** Resolve a billing mode for a harness at session creation (FEA-1434). */
  detectBillingMode: (harness: string) => string;
  /** Durable dir for persisted catchup caches. */
  stateDir: string;
  /** Push a renderer live-update after an import batch wrote rows. */
  emit: (sessionId?: string) => void;
  /**
   * Whether Claude's live file watcher should run. False when hooks are
   * installed (hooks own live Claude capture). Boot import runs regardless.
   */
  shouldWatchClaude: () => boolean;
  /** Key-free diagnostic sink. */
  log?: (message: string) => void;
  /** Injectable clock (tests pin it). */
  now?: () => string;
  /** Injectable collectors (tests pass fakes). Defaults to the five real ones. */
  collectors?: HarnessCollector[];
}

export class CollectorManager {
  private readonly options: CollectorManagerOptions;
  private readonly log: (message: string) => void;
  private readonly importer: Importer;
  private readonly collectors: HarnessCollector[];
  private readonly caches = new Map<string, CatchupCache>();
  private readonly watchers: HarnessWatcher[] = [];
  private started = false;
  private stopped = false;

  constructor(options: CollectorManagerOptions) {
    this.options = options;
    this.log = options.log ?? (() => {});
    this.importer = options.importer;
    this.collectors = options.collectors ?? defaultCollectors(options.stateDir);
    for (const collector of this.collectors) {
      if (!collector.batch) {
        this.caches.set(
          collector.key,
          createCatchupCache({
            persistPath: ingestCachePath(options.stateDir, collector.cacheName),
          }),
        );
      }
    }
  }

  /** Start boot import + live watchers. Never blocks boot; never throws. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    for (const collector of this.collectors) {
      const watch =
        collector.key === "claude" ? this.options.shouldWatchClaude() : true;
      if (watch) {
        const watcher = createHarnessWatcher({
          roots: () => collector.watchRoots(),
          match: (filename) => collector.watchMatch(filename),
          runImport: () => this.runImportFor(collector),
          log: this.log,
        });
        watcher.start(); // start() performs the initial (boot) catch-up import
        this.watchers.push(watcher);
      } else {
        // Claude with hooks on: boot historical import only, no live watcher.
        setImmediate(() => void this.runImportFor(collector));
      }
    }
  }

  /** Stop watchers, halt in-flight imports, flush caches. */
  stop(): void {
    this.stopped = true;
    for (const watcher of this.watchers) {
      try {
        watcher.stop();
      } catch {
        /* ignore */
      }
    }
    this.watchers.length = 0;
    for (const cache of this.caches.values()) {
      cache.flush();
    }
    this.started = false;
  }

  private async runImportFor(collector: HarnessCollector): Promise<void> {
    if (this.stopped) return;
    try {
      const imported = await this.importHarness(collector);
      if (imported > 0) {
        this.options.emit();
      }
    } catch (error) {
      this.log(
        `collector ${collector.key} import failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Idempotent import of every current source for one harness. Returns the count written. */
  private async importHarness(collector: HarnessCollector): Promise<number> {
    const cache = this.caches.get(collector.key);
    const sources = collector.listSources();
    let imported = 0;

    for (const source of sources) {
      if (this.stopped) break;

      let stat = null;
      if (!collector.batch && cache) {
        const status = cache.isUnchanged(source);
        if (status.unchanged) continue;
        stat = status.stat;
      }

      let sessions: NormalizedSession[];
      try {
        sessions = await collector.parse(source);
      } catch {
        continue; // a partially-written file mid-turn is normal
      }

      for (const session of sessions) {
        if (this.stopped) break;
        const result = await this.importer.importSession(session, collector.key);
        if (!(result.skipped && !result.reactivated)) imported++;
      }

      if (!collector.batch && cache) cache.markSeenWith(source, stat);
    }

    if (!collector.batch && cache) {
      cache.pruneTo(sources);
      cache.flush();
    }
    return imported;
  }
}

/** The five real harness collectors, wired with their durable state paths. */
function defaultCollectors(stateDir: string): HarnessCollector[] {
  return [
    createClaudeCollector(),
    createCodexCollector(),
    createCursorCollector(),
    createCopilotCollector(),
    createOpencodeCollector({
      fingerprintPath: ingestOpencodeFingerprintPath(stateDir),
    }),
  ];
}

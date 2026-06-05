/**
 * @file watcher.ts
 * @description Generic live file watcher for a harness (FEA-1503; generalized
 * from the per-tool vendor `*-watcher.js`). A single factory drives every
 * harness: it debounces filesystem changes, self-heals when a watched root does
 * not exist yet (the user runs their first-ever session with a tool after the
 * app booted), and runs a periodic catch-up poll as an `fs.watch` miss-fallback.
 * On every trigger it runs the supplied idempotent import for the harness; the
 * caller decides what "import" means (parse changed files → importSession → emit).
 *
 * Best-effort and non-fatal: `fs.watch` is platform-quirky and a failure here
 * must never crash the main process — the catch-up poll still keeps the dashboard
 * current.
 */
import { existsSync, watch, type FSWatcher } from "node:fs";

const DEBOUNCE_MS = 600;
const RETRY_MS = 4000;
const MAX_RETRY_ATTEMPTS = 75; // ~5 minutes at 4s intervals, then give up
const CATCHUP_POLL_MS = 5000;

export interface HarnessWatcherOptions {
  /** Directories to recursively watch (re-evaluated on each self-heal attempt). */
  roots: () => string[];
  /** Which changed filenames trigger a re-import. */
  match: (filename: string) => boolean;
  /** Idempotent import for this harness. Called on boot, debounce, and poll. */
  runImport: () => Promise<void>;
  log?: (message: string) => void;
}

export interface HarnessWatcher {
  start(): void;
  stop(): void;
}

export function createHarnessWatcher(options: HarnessWatcherOptions): HarnessWatcher {
  let started = false;
  let running = false;
  let debounceTimer: NodeJS.Timeout | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let catchupTimer: NodeJS.Timeout | null = null;
  const watchers: FSWatcher[] = [];
  const attached = new Set<string>();

  async function trigger(): Promise<void> {
    if (running) return; // never overlap an in-flight import
    running = true;
    try {
      await options.runImport();
    } catch {
      /* non-fatal — a partially-written file mid-turn is normal */
    } finally {
      running = false;
    }
  }

  function scheduleImport(): void {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void trigger();
    }, DEBOUNCE_MS);
  }

  function attach(root: string): boolean {
    if (attached.has(root)) return true;
    try {
      if (!existsSync(root)) return false;
      const w = watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        if (!options.match(String(filename))) return;
        scheduleImport();
      });
      w.on("error", () => {
        /* platform limitation — the catch-up poll still covers changes */
      });
      watchers.push(w);
      attached.add(root);
      return true;
    } catch {
      return false;
    }
  }

  /** Attach every root that exists; returns true once all roots are attached. */
  function tryAttachAll(): boolean {
    let all = true;
    for (const root of options.roots()) {
      if (!attach(root)) all = false;
    }
    return all;
  }

  function start(): void {
    if (started) return;
    started = true;

    // Initial catch-up (the boot import for this harness). Deferred a tick so a
    // synchronous batch parse cannot block the first window paint.
    setImmediate(() => void trigger());

    catchupTimer = setInterval(() => void trigger(), CATCHUP_POLL_MS);
    catchupTimer.unref();

    if (tryAttachAll()) return; // every root existed → fully attached

    let retries = 0;
    retryTimer = setInterval(() => {
      if (++retries > MAX_RETRY_ATTEMPTS) {
        if (retryTimer) clearInterval(retryTimer);
        retryTimer = null;
        return;
      }
      if (tryAttachAll()) {
        if (retryTimer) clearInterval(retryTimer);
        retryTimer = null;
        // A root just appeared after boot — catch up the sessions fs.watch missed.
        void trigger();
      }
    }, RETRY_MS);
    retryTimer.unref();
  }

  function stop(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
    if (catchupTimer) {
      clearInterval(catchupTimer);
      catchupTimer = null;
    }
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    watchers.length = 0;
    attached.clear();
    started = false;
  }

  return { start, stop };
}

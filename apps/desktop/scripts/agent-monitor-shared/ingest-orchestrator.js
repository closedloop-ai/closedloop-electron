/**
 * @file ingest-orchestrator.js
 * @description Single coordination point for the cold-start ingest of every
 * non-Claude harness (FEA-1334). Before this, server/index.js fired four
 * independent fire-and-forget import chains (Codex / Cursor / Copilot /
 * OpenCode) with no shared progress signal. This orchestrator runs them as
 * one coordinated unit and feeds the shared ingest-progress singleton, which
 * `GET /api/import/progress` exposes to the desktop renderer's floating
 * progress card.
 *
 * Harnesses are dependency-injected (the `harnesses` argument) rather than
 * required here directly: the per-harness importer modules live at different
 * relative paths in the generated runtime tree than in the source tree, so a
 * static require would only resolve in one of them. Injection keeps this
 * module pure coordination logic — identical in both trees and trivially
 * unit-testable with fakes.
 *
 * Claude is intentionally NOT orchestrated here: its legacy import is a
 * one-time bootstrap gated on an empty DB (`if (existingCount === 0)`),
 * a separate concern from the every-boot non-Claude catch-up.
 */

/**
 * @typedef {Object} HarnessSpec
 * @property {string} key - stable harness id ("codex", "cursor", ...).
 * @property {(dbModule: any, opts: ImportOpts) => Promise<any>} importAll -
 *   the harness's importAll*Sessions function. It should call
 *   `opts.onBegin(totalFiles)` once before its parse loop and
 *   `opts.onProgress()` once per source handled, and honour `opts.signal`.
 */

/**
 * @typedef {Object} ImportOpts
 * @property {AbortSignal} [signal]
 * @property {(total: number) => void} [onBegin]
 * @property {() => void} [onProgress]
 */

/**
 * Run every injected harness importer in parallel, reporting progress into
 * the ingest-progress singleton (or an injected equivalent for tests).
 * Always resolves — a single harness throwing must never abort the others
 * or reject the orchestrator.
 *
 * @param {Object} args
 * @param {any} args.dbModule - the agent-monitor db module.
 * @param {HarnessSpec[]} args.harnesses - injected harness importers.
 * @param {AbortSignal} [args.signal] - cancels not-yet-started harness work.
 * @param {any} [args.progress] - progress sink; defaults to ./ingest-progress.
 * @returns {Promise<{ ran: boolean }>}
 */
async function ingestAllHarnesses({ dbModule, harnesses, signal, progress } = {}) {
  const prog = progress || require("./ingest-progress");

  if (!dbModule || !Array.isArray(harnesses) || harnesses.length === 0) {
    return { ran: false };
  }

  prog.beginRun();

  await Promise.all(
    harnesses.map(async (harness) => {
      const key = harness && harness.key;
      if (!key) return;

      // Register the harness immediately so it shows in the progress
      // snapshot even before its importer reports a discovered total.
      prog.beginHarness(key, 0);

      const importAll = harness.importAll;
      if (typeof importAll !== "function" || (signal && signal.aborted)) {
        prog.completeHarness(key);
        return;
      }

      try {
        const result = await importAll(dbModule, {
          signal,
          onBegin: (total) => prog.beginHarness(key, total),
          onProgress: () => prog.tick(key, { parsed: 1 }),
        });
        // importAll*Sessions resolves { imported, skipped, errors }. Roll the
        // newly-imported count into progress so the card's "caught up"
        // summary can report real numbers.
        if (result && typeof result.imported === "number" && result.imported > 0) {
          prog.tick(key, { imported: result.imported });
        }
      } catch {
        /* non-fatal — one harness failing must not abort the others */
      }
      prog.completeHarness(key);
    }),
  );

  prog.endRun();
  return { ran: true };
}

module.exports = { ingestAllHarnesses };

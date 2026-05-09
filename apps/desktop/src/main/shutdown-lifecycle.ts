import type { DesktopShutdownDiagnostics } from "./telemetry-protocol.js";
import type { ShutdownResult } from "./shutdown.js";

export interface BeforeQuitEvent {
  preventDefault(): void;
}

export interface ShutdownLifecycleApplication {
  setQuitting(): void;
  shutdown(): Promise<ShutdownResult>;
  reportShutdownFailure(
    input: Omit<DesktopShutdownDiagnostics, "duringUpdate">,
  ): void;
}

export interface BeforeQuitHandlerDeps {
  application: ShutdownLifecycleApplication;
  exit: (code: number) => void;
  logInfo: (message: string) => void;
  logError: (message: string) => void;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  hardExitMs?: number;
}

/**
 * Builds the Electron before-quit handler while keeping the shutdown ownership
 * guard testable. The first invocation owns async shutdown and every re-entry
 * observes the existing promise so update-triggered quit paths cannot run
 * cleanup twice.
 */
export function createBeforeQuitHandler(deps: BeforeQuitHandlerDeps) {
  const now = deps.now ?? (() => Date.now());
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
  const hardExitMs = deps.hardExitMs ?? 8_000;
  let quitPromise: Promise<void> | null = null;

  return (event: BeforeQuitEvent): void => {
    deps.logInfo("before-quit fired");
    // Prevent Electron from proceeding until async shutdown completes.
    event.preventDefault();

    // If shutdown is already in progress, the first invocation's continuation
    // owns app.exit() exactly once.
    if (quitPromise) {
      deps.logInfo("before-quit ignored; shutdown already in progress");
      return;
    }

    // Signal the window to allow close events through, so it does not re-hide
    // itself and block the quit sequence.
    deps.application.setQuitting();
    const shutdownStartedAt = now();

    const hardExit = setTimeoutFn(() => {
      deps.logError("hard-exit timeout reached; forcing app.exit(1)");
      deps.application.reportShutdownFailure({
        trigger: "outer-hard-exit",
        outerHardExit: true,
        elapsedMs: now() - shutdownStartedAt,
      });
      deps.exit(1);
    }, hardExitMs);
    unrefTimer(hardExit);

    quitPromise = deps.application
      .shutdown()
      .then((result) => {
        clearTimeoutFn(hardExit);
        deps.exit(result === "clean" ? 0 : 1);
      })
      .catch((err: unknown) => {
        clearTimeoutFn(hardExit);
        const message = err instanceof Error ? err.message : String(err);
        deps.logError(`shutdown rejected: ${message}`);
        deps.application.reportShutdownFailure({
          trigger: "shutdown-rejected",
          result: "failed",
          phase: "desktopApplication.shutdown",
          elapsedMs: now() - shutdownStartedAt,
          error: message,
        });
        deps.exit(1);
      });
  };
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const maybeUnref = (timer as { unref?: () => void }).unref;
  if (typeof maybeUnref === "function") {
    maybeUnref.call(timer);
  }
}

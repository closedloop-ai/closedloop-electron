export interface ShutdownDeps {
  updateCheckTimer: NodeJS.Timeout | null;
  clearUpdateCheckTimer: () => void;
  observability: { shutdown: () => Promise<void> };
  cloudSocket: { stop: () => void };
  commandExecutor: { dispose: () => void };
  server: { stop: () => Promise<void> };
  desktopWindow: { dispose: () => void };
  tray: { dispose: () => void };
}

export type ShutdownResult = "clean" | "timed_out" | "failed";

export async function runShutdownSequence(
  deps: ShutdownDeps,
  options?: { timeoutMs?: number; setTimeoutFn?: typeof setTimeout }
): Promise<ShutdownResult> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const setTimeoutFn = options?.setTimeoutFn ?? setTimeout;

  let timer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = async (): Promise<"clean"> => {
    deps.clearUpdateCheckTimer();
    await deps.observability.shutdown().catch(() => {});
    deps.cloudSocket.stop();
    deps.commandExecutor.dispose();
    await deps.server.stop();
    deps.desktopWindow.dispose();
    deps.tray.dispose();
    return "clean";
  };

  const timeout = new Promise<"timed_out">((resolve) => {
    timer = setTimeoutFn(() => resolve("timed_out"), timeoutMs);
  });

  try {
    const result = await Promise.race([cleanup(), timeout]);
    return result;
  } catch {
    return "failed";
  } finally {
    if (timer != null) {
      clearTimeout(timer);
    }
  }
}

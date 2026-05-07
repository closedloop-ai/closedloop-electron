import { app, nativeTheme } from "electron";
import { DesktopApplication } from "./app.js";
import { handleActivateEvent } from "./app-lifecycle.js";
import { handleUncaughtException, handleUnhandledRejection } from "./error-handlers.js";
import { gatewayLog } from "./gateway-logger.js";

app.setName("ClosedLoop");
app.setAboutPanelOptions({
  applicationName: "ClosedLoop",
  applicationVersion: app.getVersion(),
});

process.on("uncaughtException", (err) =>
  handleUncaughtException(err, {
    log: (msg) => gatewayLog.error("uncaught", msg),
    exit: (code) => app.exit(code),
  })
);

process.on("unhandledRejection", (reason) =>
  handleUnhandledRejection(reason, {
    log: (msg) => gatewayLog.warn("unhandled-rejection", msg),
    exit: (code) => app.exit(code),
  })
);

const desktopApplication = new DesktopApplication();

app.on("ready", () => {
  nativeTheme.themeSource = "system";
  void desktopApplication.boot().catch((error) => {
    const message = error instanceof Error ? error.message : "unknown startup error";
    console.error(`desktop boot failed: ${message}`);
    app.exit(1);
  });
});

app.on("activate", () => {
  void handleActivateEvent({
    handleActivate: () => desktopApplication.handleActivate(),
    log: (message) => gatewayLog.warn("activate", message),
  });
});

let quitPromise: Promise<void> | null = null;

app.on("before-quit", (event) => {
  // Prevent Electron from proceeding until async shutdown completes.
  event.preventDefault();

  // If shutdown is already in progress (e.g. window-all-closed fired app.quit()
  // on non-macOS after DesktopWindow.dispose() closed the last window), do nothing.
  // The first invocation's .then() continuation will call app.exit() exactly once.
  if (quitPromise) {
    return;
  }

  // Signal the window to allow close events through, so it doesn't re-hide
  // itself and block the quit sequence.
  desktopApplication.setQuitting();

  const hardExit = setTimeout(() => {
    gatewayLog.error("shutdown", "hard-exit timeout reached; forcing app.exit(1)");
    app.exit(1);
  }, 8_000).unref();

  quitPromise = desktopApplication
    .shutdown()
    .then((result) => {
      clearTimeout(hardExit);
      app.exit(result === "clean" ? 0 : 1);
    })
    .catch((err: unknown) => {
      clearTimeout(hardExit);
      const message = err instanceof Error ? err.message : String(err);
      gatewayLog.error("shutdown", `shutdown rejected: ${message}`);
      app.exit(1);
    });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

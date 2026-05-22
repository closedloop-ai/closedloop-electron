import { app, nativeTheme } from "electron";
import { DesktopApplication } from "./app.js";
import { handleActivateEvent } from "./app-lifecycle.js";
import { handleUncaughtException, handleUnhandledRejection } from "./error-handlers.js";
import { gatewayLog } from "./gateway-logger.js";
import { initializePersistentLogging } from "./persistent-log.js";
import { createBeforeQuitHandler } from "./shutdown-lifecycle.js";

app.setName("ClosedLoop");
initializePersistentLogging();
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
    gatewayLog.error("startup", `desktop boot failed: ${message}`);
    app.exit(1);
  });
});

app.on("activate", () => {
  void handleActivateEvent({
    handleActivate: () => desktopApplication.handleActivate(),
    log: (message) => gatewayLog.warn("activate", message),
  });
});

app.on(
  "before-quit",
  createBeforeQuitHandler({
    application: desktopApplication,
    exit: (code) => app.exit(code),
    logInfo: (message) => gatewayLog.info("shutdown", message),
    logError: (message) => gatewayLog.error("shutdown", message),
  }),
);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

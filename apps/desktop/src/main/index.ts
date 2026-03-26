import { app, nativeTheme } from "electron";
import { DesktopApplication } from "./app.js";

app.setName("ClosedLoop");

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
  desktopApplication.showWindow();
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

  quitPromise = desktopApplication.shutdown().then((result) => {
    app.exit(result === "clean" ? 0 : 1);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

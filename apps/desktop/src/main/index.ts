import { app, nativeTheme } from "electron";
import { DesktopApplication } from "./app.js";

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
  void desktopApplication.boot().catch((error) => {
    const message = error instanceof Error ? error.message : "unknown activation error";
    console.error(`desktop activation failed: ${message}`);
  });
});

app.on("before-quit", () => {
  void desktopApplication.shutdown().catch((error) => {
    const message = error instanceof Error ? error.message : "unknown shutdown error";
    console.error(`desktop shutdown failed: ${message}`);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

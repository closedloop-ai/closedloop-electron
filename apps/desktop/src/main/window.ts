import { BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class DesktopWindow {
  private browserWindow: BrowserWindow | null = null;
  private disposing = false;

  init(): void {
    if (this.browserWindow) {
      return;
    }

    this.browserWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: false,
        preload: path.join(__dirname, "preload.js")
      }
    });
    this.browserWindow.once("ready-to-show", () => {
      this.browserWindow?.show();
    });
    this.browserWindow.on("close", (event) => {
      if (this.disposing) {
        return;
      }
      event.preventDefault();
      this.browserWindow?.hide();
    });
    const htmlPath = resolveRendererPath();
    void this.browserWindow.loadFile(htmlPath);
  }

  getWindow(): BrowserWindow | null {
    return this.browserWindow;
  }

  show(): void {
    this.browserWindow?.show();
    this.browserWindow?.focus();
  }

  dispose(): void {
    if (!this.browserWindow) {
      return;
    }

    this.disposing = true;
    this.browserWindow.close();
    this.browserWindow = null;
    this.disposing = false;
  }
}

function resolveRendererPath(): string {
  const cwd = process.cwd();
  const inDesktopCwdPath = path.join(cwd, "src", "renderer", "index.html");
  if (existsSync(inDesktopCwdPath)) {
    return inDesktopCwdPath;
  }

  return path.join(cwd, "apps", "desktop", "src", "renderer", "index.html");
}

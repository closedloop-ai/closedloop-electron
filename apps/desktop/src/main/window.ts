import { app, BrowserWindow, protocol } from "electron";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RENDERER_DIR = path.resolve(__dirname, "..", "renderer");
const APP_PROTOCOL = "app";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

function mimeType(ext: string): string {
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

function registerAppProtocol(): void {
  protocol.handle(APP_PROTOCOL, (request) => {
    const url = new URL(request.url);
    const relativePath = url.pathname.replace(/^\//, "");
    const filePath = path.join(RENDERER_DIR, relativePath);

    if (!existsSync(filePath)) {
      return new Response("Not found", { status: 404 });
    }

    const data = readFileSync(filePath);
    const ext = path.extname(filePath);
    return new Response(data, {
      status: 200,
      headers: { "Content-Type": mimeType(ext) },
    });
  });
}

export class DesktopWindow {
  private browserWindow: BrowserWindow | null = null;
  private disposing = false;
  private quitting = false;

  init(): void {
    if (this.browserWindow) {
      return;
    }

    this.browserWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      backgroundColor: "#0f1723",
      webPreferences: {
        contextIsolation: true,
        sandbox: false,
        preload: path.join(__dirname, "preload.js"),
      },
    });
    this.browserWindow.once("ready-to-show", () => {
      this.browserWindow?.show();
    });
    this.browserWindow.on("close", (event) => {
      if (this.disposing || this.quitting) {
        return;
      }
      event.preventDefault();
      this.browserWindow?.hide();
    });

    void this.loadContent();
  }

  private async loadContent(): Promise<void> {
    registerAppProtocol();

    if (app.isPackaged) {
      await this.browserWindow!.loadURL(`app://renderer/index.html`);
      return;
    }

    try {
      await this.browserWindow!.loadURL("http://localhost:5173");
    } catch {
      await this.browserWindow!.loadURL(`app://renderer/index.html`);
    }
  }

  getWindow(): BrowserWindow | null {
    return this.browserWindow;
  }

  show(): void {
    this.browserWindow?.show();
    this.browserWindow?.focus();
  }

  setQuitting(): void {
    this.quitting = true;
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

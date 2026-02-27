import { Menu, Tray, nativeImage } from "electron";

export type TrayState = "starting" | "ready" | "degraded" | "error";

export interface DesktopTrayHandlers {
  onOpen?: () => void;
  onTogglePaused?: (paused: boolean) => void;
}

const TRAY_STATE_TOOLTIP: Record<TrayState, string> = {
  starting: "Starting Symphony Desktop Client",
  ready: "Symphony Desktop Client is ready",
  degraded: "Symphony Desktop Client is running with degraded cloud status",
  error: "Symphony Desktop Client encountered a startup error"
};

export class DesktopTray {
  private tray: Tray | null = null;
  private state: TrayState = "starting";
  private paused = false;
  private pendingApprovals = 0;
  private handlers: DesktopTrayHandlers = {};

  init(handlers?: DesktopTrayHandlers): void {
    if (this.tray) {
      return;
    }
    this.handlers = handlers ?? {};

    const icon = createTrayIcon(this.pendingApprovals);
    this.tray = new Tray(icon);
    this.setState("starting");
    this.refreshContextMenu();
    this.tray.on("click", () => {
      this.handlers.onOpen?.();
    });
  }

  setState(state: TrayState, details?: string): void {
    this.state = state;
    if (!this.tray) {
      return;
    }

    const message = this.buildTooltip(details ?? TRAY_STATE_TOOLTIP[this.state]);
    this.tray.setToolTip(message);
    this.refreshContextMenu();
  }

  setPendingApprovals(count: number): void {
    this.pendingApprovals = Math.max(0, count);
    if (!this.tray) {
      return;
    }

    this.tray.setImage(createTrayIcon(this.pendingApprovals));
    if (process.platform === "darwin") {
      this.tray.setTitle(this.pendingApprovals > 0 ? ` ${Math.min(this.pendingApprovals, 99)}` : "");
    }
    this.setState(this.state);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.refreshContextMenu();
  }

  dispose(): void {
    if (!this.tray) {
      return;
    }

    this.tray.destroy();
    this.tray = null;
  }

  private refreshContextMenu(): void {
    if (!this.tray) {
      return;
    }

    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label:
            this.pendingApprovals > 0
              ? `Open Symphony (${this.pendingApprovals} pending)`
              : "Open Symphony",
          click: () => {
            this.handlers.onOpen?.();
          }
        },
        {
          label: this.paused ? "Resume" : "Pause",
          click: () => {
            this.setPaused(!this.paused);
            this.handlers.onTogglePaused?.(this.paused);
          }
        },
        { type: "separator" },
        { label: "Quit", role: "quit" }
      ])
    );
  }

  private buildTooltip(base: string): string {
    if (this.pendingApprovals === 0) {
      return base;
    }
    return `${base} | pending approvals: ${this.pendingApprovals}`;
  }
}

function createTrayIcon(pendingApprovals: number) {
  if (process.platform === "darwin") {
    const macImage = createMacStatusImage();
    if (macImage && !macImage.isEmpty()) {
      return macImage;
    }
  }

  const indicatorMarkup =
    pendingApprovals > 0
      ? `<circle cx="14.5" cy="4.5" r="2.4" fill="#dc2626"/>`
      : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
    <rect x="2" y="2" width="14" height="14" rx="4" fill="#0f172a"/>
    <text x="9" y="11.1" text-anchor="middle" font-family="Arial, sans-serif" font-size="8.4" font-weight="700" fill="#ffffff">S</text>
    ${indicatorMarkup}
  </svg>`;
  return nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`)
    .resize({ width: 18, height: 18 });
}

function createMacStatusImage() {
  const candidates = [
    "NSImageNameActionTemplate",
    "NSImageNamePreferencesGeneral",
    "NSImageNameComputer"
  ];
  for (const name of candidates) {
    try {
      const icon = nativeImage.createFromNamedImage(name);
      if (!icon.isEmpty()) {
        icon.setTemplateImage(true);
        return icon.resize({ width: 18, height: 18 });
      }
    } catch {
      continue;
    }
  }
  return null;
}

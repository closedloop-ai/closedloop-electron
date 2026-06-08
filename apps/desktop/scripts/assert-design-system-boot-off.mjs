#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Module, { registerHooks } from "node:module";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[2] === "--probe-child") {
  await runProbeChild();
} else {
  runParent();
}

function runParent() {
  const output = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(import.meta.url),
      "--probe-child",
    ],
    {
      cwd: appDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  ).trim();

  console.log(JSON.stringify({ ok: true, summary: JSON.parse(lastJsonLine(output)) }, null, 2));
}

function lastJsonLine(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const line = [...lines].reverse().find((candidate) => candidate.startsWith("{"));
  if (!line) {
    throw new Error(`Boot probe did not emit JSON output:\n${output}`);
  }
  return line;
}

async function runProbeChild() {
  const userDataPath = mkdtempSync(
    path.join(tmpdir(), "agent-dashboard-disabled-boot-"),
  );
  const state = createProbeState(userDataPath);
  globalThis.__agentDashboardBootProbeState = state;

  const electronCjsStub = createElectronCjsStub(state);
  globalThis.__agentDashboardBootProbeElectronCjs = electronCjsStub;
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") {
      return electronCjsStub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "electron") {
        return stub("electron");
      }
      if (specifier === "electron-log/main.js") {
        return stub("electron-log-main");
      }
      if (specifier === "electron-updater") {
        return stub("electron-updater");
      }
      if (specifier === "electron-store") {
        return stub("electron-store");
      }
      if (specifier === "node:child_process") {
        return stub("node-child-process");
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith("file:")) {
        const filePath = fileURLToPath(url);
        if (isAgentDashboardRuntimeModule(filePath)) {
          state.loadedRuntimeModules.push(toAppRelative(filePath));
        }
      }
      return nextLoad(url, context);
    },
  });

  let exitAfterCleanup = false;
  try {
    await import(pathToFileURL(path.join(appDir, "src/main/index.ts")).href);
    state.app.emit("ready");
    await waitFor(() => state.browserWindows.length > 0, 4_000);
    await settle();

    const summary = summarizeState(state);
    assertNoAgentDashboardBootEffects(summary);
    process.stdout.write(JSON.stringify(summary));
    exitAfterCleanup = true;
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
    if (exitAfterCleanup) {
      process.exit(0);
    }
  }
}

function createProbeState(userDataPath) {
  return {
    userDataPath,
    app: null,
    settingsSeed: {
      agentMonitorEnabled: false,
      cloudConnectionEnabled: false,
      onboardingCompleted: false,
    },
    loadedRuntimeModules: [],
    ipcHandlers: new Set(),
    ipcRemovedHandlers: [],
    protocolHandles: [],
    browserWindows: [],
    loadUrls: [],
    exits: [],
    childProcesses: [],
  };
}

function createElectronCjsStub(state) {
  class ProbeApp extends EventEmitter {
    isPackaged = false;
    dock = {
      setIcon: () => undefined,
    };

    getVersion() {
      return "0.0.0-boot-probe";
    }

    setName() {}

    setAboutPanelOptions() {}

    getPath(name) {
      if (name === "userData") {
        return state.userDataPath;
      }
      if (name === "logs") {
        return path.join(state.userDataPath, "logs");
      }
      return state.userDataPath;
    }

    exit(code = 0) {
      state.exits.push(code);
    }

    quit() {
      state.exits.push(0);
    }
  }

  class ProbeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.visible = false;
      this.webContents = new EventEmitter();
      this.webContents.send = (channel, payload) => {
        state.sentMessages ??= [];
        state.sentMessages.push({ channel, payload });
      };
      this.webContents.setWindowOpenHandler = (handler) => {
        this.windowOpenHandler = handler;
      };
      state.browserWindows.push({
        preload: options?.webPreferences?.preload ?? null,
        additionalArguments:
          options?.webPreferences?.additionalArguments ?? [],
      });
    }

    loadURL(url) {
      state.loadUrls.push(url);
      return Promise.resolve();
    }

    once(eventName, listener) {
      if (eventName === "ready-to-show") {
        queueMicrotask(listener);
        return this;
      }
      return super.once(eventName, listener);
    }

    show() {
      this.visible = true;
    }

    hide() {
      this.visible = false;
    }

    focus() {}

    isVisible() {
      return this.visible;
    }

    close() {
      this.emit("close", { preventDefault: () => undefined });
    }
  }

  class ProbeNotification extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
    }

    show() {}
  }

  class ProbeTray extends EventEmitter {
    setToolTip() {}
    setContextMenu() {}
    setImage() {}
    setTitle() {}
    destroy() {}
  }

  const app = new ProbeApp();
  state.app = app;
  return {
    app,
    BrowserWindow: ProbeBrowserWindow,
    Notification: ProbeNotification,
    Tray: ProbeTray,
    Menu: { buildFromTemplate: (template) => template },
    nativeTheme: { themeSource: "system" },
    nativeImage: {
      createFromPath: () => ({ setTemplateImage: () => undefined }),
    },
    protocol: {
      registerSchemesAsPrivileged: () => undefined,
      handle: (scheme) => {
        state.protocolHandles.push(scheme);
      },
      unhandle: () => undefined,
    },
    ipcMain: {
      handle: (channel) => {
        state.ipcHandlers.add(channel);
      },
      removeHandler: (channel) => {
        state.ipcRemovedHandlers.push(channel);
        state.ipcHandlers.delete(channel);
      },
    },
    dialog: {
      showMessageBox: async () => ({ response: 0 }),
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
    shell: {
      openExternal: async () => undefined,
      openPath: async () => "",
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (text) => Buffer.from(text, "utf8"),
      decryptString: (buffer) => Buffer.from(buffer).toString("utf8"),
    },
    powerMonitor: new EventEmitter(),
  };
}

function stub(kind) {
  return {
    shortCircuit: true,
    url: `data:text/javascript,${encodeURIComponent(stubSource(kind))}`,
  };
}

function stubSource(kind) {
  if (kind === "electron") {
    return `
      const cjs = globalThis.__agentDashboardBootProbeElectronCjs;
      export const app = cjs.app;
      export const BrowserWindow = cjs.BrowserWindow;
      export const Notification = cjs.Notification;
      export const Tray = cjs.Tray;
      export const Menu = cjs.Menu;
      export const nativeTheme = cjs.nativeTheme;
      export const nativeImage = cjs.nativeImage;
      export const protocol = cjs.protocol;
      export const ipcMain = cjs.ipcMain;
      export const dialog = cjs.dialog;
      export const shell = cjs.shell;
      export const safeStorage = cjs.safeStorage;
      export const powerMonitor = cjs.powerMonitor;
      export default cjs;
    `;
  }
  if (kind === "electron-log-main") {
    return `
      const fileTransport = {
        level: false,
        fileName: "main.log",
        maxSize: 0,
        archiveLogFn: undefined,
        getFile: () => ({ path: globalThis.__agentDashboardBootProbeState.userDataPath + "/logs/main.log" }),
      };
      const electronLog = {
        initialize: () => undefined,
        transports: {
          console: { level: false, writeFn: () => undefined },
          file: fileTransport,
        },
        error: () => undefined,
        warn: () => undefined,
        debug: () => undefined,
        info: () => undefined,
      };
      export default electronLog;
    `;
  }
  if (kind === "electron-updater") {
    return `
      export const autoUpdater = {
        logger: null,
        autoDownload: false,
        autoInstallOnAppQuit: false,
        on: () => undefined,
        checkForUpdates: async () => null,
        quitAndInstall: () => undefined,
      };
      export default { autoUpdater };
    `;
  }
  if (kind === "electron-store") {
    return `
      export default class Store {
        constructor() {
          this.store = { ...globalThis.__agentDashboardBootProbeState.settingsSeed };
        }
        get(key, defaultValue) {
          return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : defaultValue;
        }
        set(key, value) {
          this.store[key] = value;
        }
        delete(key) {
          delete this.store[key];
        }
      }
    `;
  }
  if (kind === "node-child-process") {
    return `
      import { EventEmitter } from "node:events";
      function child() {
        const instance = new EventEmitter();
        instance.pid = Math.floor(Math.random() * 100000) + 1000;
        instance.stdout = new EventEmitter();
        instance.stderr = new EventEmitter();
        instance.kill = () => true;
        globalThis.__agentDashboardBootProbeState.childProcesses.push(instance.pid);
        return instance;
      }
      export function spawn() { return child(); }
      export function spawnSync() { return { status: 0, stdout: "", stderr: "" }; }
      export function execSync() { return ""; }
      export function execFileSync() { return ""; }
      export function execFile(_file, _args, options, callback) {
        const cb = typeof options === "function" ? options : callback;
        queueMicrotask(() => cb?.(null, "", ""));
        return child();
      }
    `;
  }
  throw new Error(`Unknown stub kind: ${kind}`);
}

function summarizeState(state) {
  const dbHandlers = [...state.ipcHandlers].filter((channel) =>
    channel.startsWith("desktop:db:"),
  );
  const pgliteDataDir = path.join(state.userDataPath, "agent-dashboard.pgdata");
  return {
    userDataPath: state.userDataPath,
    loadedRuntimeModules: state.loadedRuntimeModules,
    dbHandlers,
    pgliteDataDirExists: existsSync(pgliteDataDir),
    browserWindows: state.browserWindows,
    loadUrls: state.loadUrls,
    exits: state.exits,
  };
}

function assertNoAgentDashboardBootEffects(summary) {
  const failures = [];
  if (summary.loadedRuntimeModules.length > 0) {
    failures.push(`loaded Agent Dashboard runtime modules: ${summary.loadedRuntimeModules.join(", ")}`);
  }
  if (summary.dbHandlers.length > 0) {
    failures.push(`registered DB IPC handlers: ${summary.dbHandlers.join(", ")}`);
  }
  if (summary.pgliteDataDirExists) {
    failures.push("created agent-dashboard.pgdata under temp userData");
  }
  if (summary.exits.some((code) => code !== 0)) {
    failures.push(`boot called app.exit with non-zero code: ${summary.exits.join(", ")}`);
  }
  if (failures.length > 0) {
    throw new Error(`disabled Agent Dashboard boot assertion failed: ${failures.join("; ")}`);
  }
}

function isAgentDashboardRuntimeModule(filePath) {
  const relative = toAppRelative(filePath);
  return (
    relative === "src/main/agent-dashboard-design-system-runtime.ts" ||
    relative === "src/main/agent-monitor-listener.ts" ||
    relative.startsWith("src/main/collectors/") ||
    relative.startsWith("src/main/database/")
  );
}

function toAppRelative(filePath) {
  return path.relative(appDir, filePath).split(path.sep).join("/");
}

async function waitFor(predicate, timeoutMs) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for Desktop boot probe side effects");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function settle() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

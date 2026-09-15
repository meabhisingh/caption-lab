import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, createWriteStream, type PathLike } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  safeStorage,
  session,
  shell,
} from "electron";

const WEB_PORT = 43_110;
const API_PORT = 43_111;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const REQUIRED_KEYS = [
  "DATABASE_URL",
  "GROQ_API_KEY",
  "REDIS_URL",
  "AWS_ACCESS_KEY",
  "AWS_SECRET_KEY",
  "STORAGE_REGION",
  "STORAGE_BUCKET",
] as const;

type SettingsKey = (typeof REQUIRED_KEYS)[number];
type StoredSettings = Record<SettingsKey, string> & {
  GPU_FRAME_ACCELERATION: boolean;
};
type ServiceState = "needs-setup" | "starting" | "ready" | "error";

interface SettingsInput {
  DATABASE_URL?: string;
  GROQ_API_KEY?: string;
  REDIS_URL?: string;
  AWS_ACCESS_KEY?: string;
  AWS_SECRET_KEY?: string;
  STORAGE_REGION?: string;
  STORAGE_BUCKET?: string;
  GPU_FRAME_ACCELERATION?: boolean;
}

interface ServiceSnapshot {
  configured: boolean;
  state: ServiceState;
  error: string | null;
  savedFields: Record<SettingsKey, boolean>;
  values: Pick<
    StoredSettings,
    "STORAGE_REGION" | "STORAGE_BUCKET" | "GPU_FRAME_ACCELERATION"
  >;
}

interface RuntimeManifest {
  browserExecutable: string;
}

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, "../../..");
let mainWindow: BrowserWindow | null = null;
let webProcess: ChildProcess | null = null;
let backendProcess: ChildProcess | null = null;
let backendOperation: Promise<void> = Promise.resolve();
let state: ServiceState = "needs-setup";
let serviceError: string | null = null;
let isQuitting = false;

const diagnosticLog = (message: string) => {
  const logFile = process.env.CAPTIONLAB_LOG_FILE;
  if (!logFile) return;
  try {
    appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // Diagnostics must never prevent the app from starting.
  }
};

process.on("uncaughtException", (error) => {
  diagnosticLog(`uncaughtException ${error.stack ?? error.message}`);
});
process.on("unhandledRejection", (error) => {
  diagnosticLog(`unhandledRejection ${String(error)}`);
});
diagnosticLog("main module loaded");

const emptySavedFields = (): Record<SettingsKey, boolean> =>
  Object.fromEntries(REQUIRED_KEYS.map((key) => [key, false])) as Record<
    SettingsKey,
    boolean
  >;

const settingsFile = () =>
  join(app.getPath("userData"), "captionlab-data", "settings.enc");

const encryptSettings = async (settings: StoredSettings) => {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error(
      "Secure credential storage is unavailable on this computer. Configure an operating-system keychain and restart CaptionLab.",
    );
  }
  return safeStorage.encryptStringAsync(JSON.stringify(settings));
};

const writeSettings = async (settings: StoredSettings) => {
  const path = settingsFile();
  const temporaryPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  const encrypted = await encryptSettings(settings);
  await writeFile(temporaryPath, encrypted.toString("base64"), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
};

const readSettings = async (): Promise<StoredSettings | null> => {
  try {
    const encoded = await readFile(settingsFile(), "utf8");
    const decrypted = await safeStorage.decryptStringAsync(
      Buffer.from(encoded, "base64"),
    );
    const parsed = JSON.parse(decrypted.result) as Partial<StoredSettings>;
    if (!REQUIRED_KEYS.every((key) => Boolean(parsed[key]?.trim()))) {
      return null;
    }
    const settings = {
      ...parsed,
      GPU_FRAME_ACCELERATION: parsed.GPU_FRAME_ACCELERATION === true,
    } as StoredSettings;
    if (decrypted.shouldReEncrypt) await writeSettings(settings);
    return settings;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("ENOENT") || error.message.includes("no such"))
    ) {
      return null;
    }
    console.error("Could not read desktop settings", error);
    return null;
  }
};

const validateUrl = (value: string, label: string) => {
  try {
    const parsed = new URL(value);
    if (
      !["postgres:", "postgresql:", "redis:", "rediss:"].includes(
        parsed.protocol,
      )
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(`${label} is not a valid connection URL.`);
  }
};

const mergeAndValidateSettings = (
  input: unknown,
  current: StoredSettings | null,
): StoredSettings => {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid settings payload.");
  }
  const values = input as SettingsInput;
  const credentials = Object.fromEntries(
    REQUIRED_KEYS.map((key) => [
      key,
      values[key]?.trim() || current?.[key] || "",
    ]),
  ) as Record<SettingsKey, string>;
  const merged: StoredSettings = {
    ...credentials,
    GPU_FRAME_ACCELERATION:
      typeof values.GPU_FRAME_ACCELERATION === "boolean"
        ? values.GPU_FRAME_ACCELERATION
        : (current?.GPU_FRAME_ACCELERATION ?? false),
  };
  const missing = REQUIRED_KEYS.filter((key) => !credentials[key]);
  if (missing.length) {
    throw new Error(`Complete the required fields: ${missing.join(", ")}.`);
  }
  validateUrl(merged.DATABASE_URL, "Database URL");
  validateUrl(merged.REDIS_URL, "Redis URL");
  return merged;
};

const publicSnapshot = async (): Promise<ServiceSnapshot> => {
  const settings = await readSettings();
  return {
    configured: Boolean(settings),
    state,
    error: serviceError,
    savedFields: settings
      ? (Object.fromEntries(
          REQUIRED_KEYS.map((key) => [key, Boolean(settings[key])]),
        ) as Record<SettingsKey, boolean>)
      : emptySavedFields(),
    values: {
      STORAGE_REGION: settings?.STORAGE_REGION ?? "ap-southeast-1",
      STORAGE_BUCKET: settings?.STORAGE_BUCKET ?? "",
      GPU_FRAME_ACCELERATION: settings?.GPU_FRAME_ACCELERATION ?? false,
    },
  };
};

const broadcastStatus = async () => {
  const window = mainWindow;
  if (window && !window.isDestroyed()) {
    window.webContents.send("captionlab:status", await publicSnapshot());
  }
};

const setState = async (
  nextState: ServiceState,
  error: string | null = null,
) => {
  state = nextState;
  serviceError = error;
  await broadcastStatus();
};

const attachLogs = (child: ChildProcess, name: string) => {
  child.stdout?.on("data", (chunk: Buffer) => {
    const message = chunk.toString().trimEnd();
    console.log(`[${name}] ${message}`);
    diagnosticLog(`[${name}] ${message}`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const message = chunk.toString().trimEnd();
    console.error(`[${name}] ${message}`);
    diagnosticLog(`[${name}] ${message}`);
  });
};

const spawnCommand = (
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
) => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    shell:
      process.platform === "win32" &&
      /(?:^|\\|\/)pnpm(?:\.cmd)?$/i.test(command),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.on("error", (error) => {
    diagnosticLog(
      `spawn failed for ${command}: ${error.stack ?? error.message}`,
    );
  });
  return child;
};

const spawnElectronNode = (
  script: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
) =>
  spawnCommand(process.execPath, [script, ...args], {
    ...options,
    env: {
      ...options.env,
      ELECTRON_RUN_AS_NODE: "1",
    },
  });

const waitForUrl = async (url: string, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await net.fetch(url);
      if (response.ok) return;
    } catch {
      // The local process is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
  }
  throw new Error(`Timed out waiting for ${url}`);
};

const waitForExit = async (child: ChildProcess, timeoutMs = 5_000) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    once(child, "exit"),
    new Promise((resolveDelay) => setTimeout(resolveDelay, timeoutMs)),
  ]);
};

const stopBackend = async () => {
  const child = backendProcess;
  backendProcess = null;
  if (!child) return;
  child.kill();
  await waitForExit(child);
};

const backendEnvironment = async (settings: StoredSettings) => {
  const { GPU_FRAME_ACCELERATION, ...serviceSettings } = settings;
  const environment: NodeJS.ProcessEnv = {
    ...serviceSettings,
    PORT: String(API_PORT),
    CORS_ORIGIN: WEB_ORIGIN,
    NODE_ENV: app.isPackaged ? "production" : "development",
    WORKER_CONCURRENCY: "1",
    ...(GPU_FRAME_ACCELERATION ? { REMOTION_GL: "angle" } : {}),
  };
  if (app.isPackaged) {
    const backendDirectory = join(process.resourcesPath, "backend");
    const manifest = JSON.parse(
      await readFile(join(backendDirectory, "captionlab-runtime.json"), "utf8"),
    ) as RuntimeManifest;
    environment.REMOTION_ENTRY_POINT = join(
      backendDirectory,
      "node_modules/@caption-generator/captions/src/remotion-entry.tsx",
    );
    environment.REMOTION_BROWSER_EXECUTABLE = resolve(
      backendDirectory,
      manifest.browserExecutable,
    );
  }
  return environment;
};

const runMigration = async (environment: NodeJS.ProcessEnv) => {
  const child = app.isPackaged
    ? spawnElectronNode(
        join(
          process.resourcesPath,
          "backend/node_modules/prisma/build/index.js",
        ),
        [
          "migrate",
          "deploy",
          "--config",
          join(
            process.resourcesPath,
            "backend/node_modules/@caption-generator/db/prisma7.config.ts",
          ),
        ],
        { cwd: join(process.resourcesPath, "backend"), env: environment },
      )
    : spawnCommand(
        process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        [
          "--filter",
          "@caption-generator/db",
          "exec",
          "prisma",
          "migrate",
          "deploy",
          "--config",
          "prisma7.config.ts",
        ],
        { cwd: repositoryRoot, env: environment },
      );
  attachLogs(child, "migration");
  const [exitCode] = (await once(child, "exit")) as [number | null];
  if (exitCode !== 0)
    throw new Error(
      "Database migration failed. Check the database URL and logs.",
    );
};

const launchBackend = async (settings: StoredSettings) => {
  await stopBackend();
  await setState("starting");
  const environment = await backendEnvironment(settings);
  try {
    await runMigration(environment);
    const child = app.isPackaged
      ? spawnElectronNode(
          join(process.resourcesPath, "backend/node_modules/tsx/dist/cli.mjs"),
          [join(process.resourcesPath, "backend/src/index.ts")],
          { cwd: join(process.resourcesPath, "backend"), env: environment },
        )
      : spawnCommand(
          process.platform === "win32" ? "pnpm.cmd" : "pnpm",
          ["--filter", "server", "start"],
          { cwd: repositoryRoot, env: environment },
        );
    backendProcess = child;
    attachLogs(child, "backend");
    child.once("exit", (exitCode) => {
      if (backendProcess !== child || isQuitting) return;
      backendProcess = null;
      void setState(
        "error",
        `The local backend stopped unexpectedly${exitCode === null ? "." : ` (exit ${exitCode}).`}`,
      );
    });
    await waitForUrl(`${API_ORIGIN}/health`, 60_000);
    await setState("ready");
  } catch (error) {
    await stopBackend();
    const message =
      error instanceof Error
        ? error.message
        : "Could not start the local backend.";
    await setState("error", message);
    throw error;
  }
};

const queueBackendLaunch = (settings: StoredSettings) => {
  backendOperation = backendOperation
    .catch(() => undefined)
    .then(() => launchBackend(settings));
  return backendOperation;
};

const startWeb = async () => {
  diagnosticLog(`starting web process (packaged=${String(app.isPackaged)})`);
  const child = app.isPackaged
    ? spawnElectronNode(join(process.resourcesPath, "web/server.js"), [], {
        cwd: join(process.resourcesPath, "web"),
        env: {
          HOSTNAME: "127.0.0.1",
          PORT: String(WEB_PORT),
          NODE_ENV: "production",
        },
      })
    : spawnCommand(
        process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        [
          "--filter",
          "web",
          "dev",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(WEB_PORT),
        ],
        {
          cwd: repositoryRoot,
          env: { NEXT_PUBLIC_SERVER_URL: API_ORIGIN },
        },
      );
  webProcess = child;
  diagnosticLog(`web process spawned (pid=${String(child.pid)})`);
  attachLogs(child, "web");
  child.once("exit", (exitCode) => {
    diagnosticLog(`web process exited with ${String(exitCode)}`);
    if (!isQuitting && webProcess === child) {
      dialog.showErrorBox(
        "CaptionLab stopped",
        `The desktop UI stopped unexpectedly${exitCode === null ? "." : ` (exit ${exitCode}).`}`,
      );
      app.quit();
    }
  });
  await waitForUrl(WEB_ORIGIN, 90_000);
};

const isTrustedSender = (event: Electron.IpcMainInvokeEvent) =>
  event.senderFrame?.origin === WEB_ORIGIN;

const registerIpc = () => {
  ipcMain.handle("captionlab:get-settings", async (event) => {
    if (!isTrustedSender(event)) throw new Error("Untrusted settings request.");
    return publicSnapshot();
  });
  ipcMain.handle("captionlab:save-settings", async (event, input: unknown) => {
    if (!isTrustedSender(event)) throw new Error("Untrusted settings request.");
    const settings = mergeAndValidateSettings(input, await readSettings());
    await writeSettings(settings);
    await queueBackendLaunch(settings);
    return publicSnapshot();
  });
  ipcMain.handle(
    "captionlab:download",
    async (event, sourceUrl: unknown, suggestedName: unknown) => {
      if (!isTrustedSender(event))
        throw new Error("Untrusted download request.");
      if (typeof sourceUrl !== "string")
        throw new Error("Invalid download URL.");
      const parsed = new URL(sourceUrl);
      if (!["https:", "http:"].includes(parsed.protocol)) {
        throw new Error("Only HTTP downloads are supported.");
      }
      const result = await dialog.showSaveDialog(mainWindow!, {
        defaultPath:
          typeof suggestedName === "string" ? suggestedName : "captions.webm",
        filters: [{ name: "WebM video", extensions: ["webm"] }],
      });
      if (result.canceled || !result.filePath) return false;
      const response = await net.fetch(sourceUrl);
      if (!response.ok || !response.body) {
        throw new Error(`Download failed with HTTP ${response.status}.`);
      }
      await pipeline(
        Readable.fromWeb(response.body as never),
        createWriteStream(result.filePath as PathLike),
      );
      return true;
    },
  );
};

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: "#08080a",
    show: false,
    title: "CaptionLab",
    webPreferences: {
      preload: join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(WEB_ORIGIN)) return;
    event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    diagnosticLog("main window closed");
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    diagnosticLog(`renderer process gone: ${details.reason}`);
  });
  mainWindow = window;
  void window.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        `<!doctype html><html><body style="margin:0;background:#08080a;color:#a1a1aa;font:14px system-ui;display:grid;place-items:center;height:100vh"><div style="text-align:center"><div style="color:#bef264;font-size:20px;font-weight:700;margin-bottom:8px">CaptionLab</div><div>Starting your local studio…</div></div></body></html>`,
      ),
  );
};

const stopChildren = () => {
  backendProcess?.kill();
  webProcess?.kill();
  backendProcess = null;
  webProcess = null;
};

if (!app.requestSingleInstanceLock()) {
  diagnosticLog("single-instance lock unavailable");
  app.quit();
} else {
  diagnosticLog("single-instance lock acquired");
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    diagnosticLog("electron ready");
    registerIpc();
    diagnosticLog("ipc registered");
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    diagnosticLog("permission handler registered");
    try {
      createWindow();
      diagnosticLog("loading window created");
      await startWeb();
      diagnosticLog("local web server ready");
      await mainWindow?.loadURL(WEB_ORIGIN);
      const settings = await readSettings();
      if (settings) void queueBackendLaunch(settings).catch(() => undefined);
      else await setState("needs-setup");
    } catch (error) {
      diagnosticLog(
        `startup failed ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
      dialog.showErrorBox(
        "CaptionLab could not start",
        error instanceof Error
          ? error.message
          : "The local application failed to start.",
      );
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && webProcess)
      createWindow();
  });

  app.on("before-quit", () => {
    diagnosticLog("before quit");
    isQuitting = true;
    stopChildren();
  });

  app.on("window-all-closed", () => {
    diagnosticLog("all windows closed");
    if (process.platform !== "darwin") app.quit();
  });

  app.on("quit", (_event, exitCode) => {
    diagnosticLog(`app quit with ${exitCode}`);
  });
}

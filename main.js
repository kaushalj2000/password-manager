const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const http = require("http");
const fs = require("fs/promises");
const path = require("path");

let mainWindow = null;
let bridgeServer = null;
let updateState = {
  status: "idle",
  message: "Updates are available through GitHub Releases.",
  version: app.getVersion(),
};
const EXTENSION_BRIDGE_PORT = 37654;
const extensionBridgeState = {
  unlocked: false,
  token: null,
  entries: [],
  vaultName: "",
  lastUpdatedAt: null,
};

function sendUpdateStatus(payload) {
  updateState = {
    ...updateState,
    ...payload,
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:update-status", updateState);
  }
}

function createJsonResponse(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-PocketVault-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  response.end(JSON.stringify(payload));
}

function getHostCandidates(rawValue) {
  if (!rawValue) {
    return [];
  }

  const candidates = new Set();
  const normalized = String(rawValue).trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const addHost = (value) => {
    if (!value) {
      return;
    }

    let host = value.trim().toLowerCase();
    host = host.replace(/^https?:\/\//, "");
    host = host.replace(/^www\./, "");
    host = host.split("/")[0];
    host = host.split(":")[0];
    if (host) {
      candidates.add(host);
    }
  };

  addHost(normalized);

  try {
    addHost(new URL(normalized).hostname);
  } catch (error) {
    if (normalized.includes(".")) {
      addHost(normalized);
    }
  }

  const urlMatches = normalized.match(/https?:\/\/[^\s]+/g) || [];
  urlMatches.forEach((match) => {
    try {
      addHost(new URL(match).hostname);
    } catch (error) {
      addHost(match);
    }
  });

  return [...candidates];
}

function matchesEntryToHostname(entry, hostname) {
  const normalizedHostname = hostname.replace(/^www\./, "").toLowerCase();
  const hostCandidates = new Set([
    ...getHostCandidates(entry.site),
    ...getHostCandidates(entry.notes),
  ]);

  return [...hostCandidates].some((candidate) => (
    normalizedHostname === candidate ||
    normalizedHostname.endsWith(`.${candidate}`) ||
    candidate.endsWith(`.${normalizedHostname}`)
  ));
}

function getMatchingEntries(pageUrl) {
  if (!pageUrl) {
    return [];
  }

  let hostname = "";
  try {
    hostname = new URL(pageUrl).hostname;
  } catch (error) {
    return [];
  }

  return extensionBridgeState.entries
    .filter((entry) => matchesEntryToHostname(entry, hostname))
    .sort((left, right) => {
      if (left.pinned !== right.pinned) {
        return Number(right.pinned) - Number(left.pinned);
      }

      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    })
    .map((entry) => ({
      id: entry.id,
      site: entry.site,
      account: entry.account,
      password: entry.password,
      notes: entry.notes || "",
      updatedAt: entry.updatedAt,
      pinned: Boolean(entry.pinned),
    }));
}

function handleBridgeRequest(request, response, rawBody) {
  if (request.method === "OPTIONS") {
    createJsonResponse(response, 204, {});
    return;
  }

  if (request.url === "/health" && request.method === "GET") {
    createJsonResponse(response, 200, {
      ok: true,
      app: "PocketVault",
      unlocked: extensionBridgeState.unlocked,
      port: EXTENSION_BRIDGE_PORT,
    });
    return;
  }

  const token = request.headers["x-pocketvault-token"];
  if (!extensionBridgeState.token || token !== extensionBridgeState.token) {
    createJsonResponse(response, 401, {
      ok: false,
      error: "Unauthorized extension request.",
    });
    return;
  }

  if (!extensionBridgeState.unlocked) {
    createJsonResponse(response, 423, {
      ok: false,
      error: "PocketVault is locked.",
    });
    return;
  }

  if (request.url === "/v1/status" && request.method === "GET") {
    createJsonResponse(response, 200, {
      ok: true,
      unlocked: extensionBridgeState.unlocked,
      vaultName: extensionBridgeState.vaultName,
      entryCount: extensionBridgeState.entries.length,
      lastUpdatedAt: extensionBridgeState.lastUpdatedAt,
    });
    return;
  }

  if (request.url === "/v1/credentials/lookup" && request.method === "POST") {
    try {
      const body = rawBody ? JSON.parse(rawBody) : {};
      const matches = getMatchingEntries(body.url);
      createJsonResponse(response, 200, {
        ok: true,
        matches,
      });
    } catch (error) {
      createJsonResponse(response, 400, {
        ok: false,
        error: "Invalid lookup request.",
      });
    }
    return;
  }

  createJsonResponse(response, 404, {
    ok: false,
    error: "Route not found.",
  });
}

function startExtensionBridgeServer() {
  if (bridgeServer) {
    return;
  }

  bridgeServer = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      handleBridgeRequest(request, response, rawBody);
    });
    request.on("error", () => {
      createJsonResponse(response, 500, {
        ok: false,
        error: "Bridge request failed.",
      });
    });
  });

  bridgeServer.listen(EXTENSION_BRIDGE_PORT, "127.0.0.1");
}

function stopExtensionBridgeServer() {
  if (!bridgeServer) {
    return;
  }

  bridgeServer.close();
  bridgeServer = null;
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatus({
      status: "checking",
      message: "Checking GitHub Releases for updates...",
    });
  });

  autoUpdater.on("update-available", (info) => {
    sendUpdateStatus({
      status: "available",
      message: `Version ${info.version} is available.`,
      availableVersion: info.version,
    });
  });

  autoUpdater.on("update-not-available", () => {
    sendUpdateStatus({
      status: "not-available",
      message: `You are up to date on version ${app.getVersion()}.`,
      availableVersion: null,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendUpdateStatus({
      status: "downloading",
      message: `Downloading update... ${Math.round(progress.percent)}%`,
      progress: Math.round(progress.percent),
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    sendUpdateStatus({
      status: "downloaded",
      message: `Version ${info.version} is ready to install.`,
      availableVersion: info.version,
      progress: 100,
    });
  });

  autoUpdater.on("error", (error) => {
    sendUpdateStatus({
      status: "error",
      message: `Update check failed: ${error?.message || "Unknown error"}`,
    });
  });
}

ipcMain.handle("vault:save", async (_event, suggestedName = "pocketvault.vault") => {
  const result = await dialog.showSaveDialog({
    title: "Create Vault File",
    defaultPath: suggestedName,
    filters: [{ name: "Encrypted Password Vault", extensions: ["vault"] }],
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  return {
    canceled: false,
    filePath: result.filePath,
    name: path.basename(result.filePath),
  };
});

ipcMain.handle("vault:open", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open Vault File",
    properties: ["openFile"],
    filters: [{ name: "Encrypted Password Vault", extensions: ["vault"] }],
  });

  const filePath = result.filePaths?.[0];
  if (result.canceled || !filePath) {
    return { canceled: true };
  }

  return {
    canceled: false,
    filePath,
    name: path.basename(filePath),
  };
});

ipcMain.handle("vault:read", async (_event, filePath) => {
  return fs.readFile(filePath, "utf8");
});

ipcMain.handle("vault:write", async (_event, filePath, content) => {
  await fs.writeFile(filePath, content, "utf8");
  return true;
});

ipcMain.handle("extension-bridge:get-state", async () => ({
  port: EXTENSION_BRIDGE_PORT,
  ...extensionBridgeState,
}));

ipcMain.handle("extension-bridge:update-state", async (_event, payload = {}) => {
  extensionBridgeState.unlocked = Boolean(payload.unlocked);
  extensionBridgeState.token = payload.token || extensionBridgeState.token;
  extensionBridgeState.entries = Array.isArray(payload.entries) ? payload.entries : [];
  extensionBridgeState.vaultName = payload.vaultName || "";
  extensionBridgeState.lastUpdatedAt = payload.lastUpdatedAt || null;

  return {
    ok: true,
    port: EXTENSION_BRIDGE_PORT,
    ...extensionBridgeState,
  };
});

ipcMain.handle("app:update-check", async () => {
  if (!app.isPackaged) {
    sendUpdateStatus({
      status: "dev",
      message: "Auto-update checks run only in installed builds.",
    });
    return false;
  }

  autoUpdater.checkForUpdates();
  return true;
});

ipcMain.handle("app:update-download", async () => {
  if (!app.isPackaged) {
    sendUpdateStatus({
      status: "dev",
      message: "Download updates from a packaged build only.",
    });
    return false;
  }

  autoUpdater.downloadUpdate();
  return true;
});

ipcMain.handle("app:update-install", async () => {
  if (!app.isPackaged) {
    return false;
  }

  autoUpdater.quitAndInstall();
  return true;
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1400,
    height: 940,
    minWidth: 1100,
    minHeight: 760,
    show: false,
    backgroundColor: "#f4ebdf",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.loadFile(path.join(__dirname, "index.html"));
  window.once("ready-to-show", () => {
    window.maximize();
    window.show();
  });
  window.webContents.on("did-finish-load", () => {
    sendUpdateStatus(updateState);
    if (app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify().catch((error) => {
        sendUpdateStatus({
          status: "error",
          message: `Automatic update check failed: ${error?.message || "Unknown error"}`,
        });
      });
    } else {
      sendUpdateStatus({
        status: "dev",
        message: "Auto-updates are active only in packaged releases.",
      });
    }
  });

  return window;
}

app.whenReady().then(() => {
  configureAutoUpdater();
  startExtensionBridgeServer();
  mainWindow = createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopExtensionBridgeServer();
});

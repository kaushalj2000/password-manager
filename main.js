const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs/promises");
const path = require("path");

let mainWindow = null;
let updateState = {
  status: "idle",
  message: "Updates are available through GitHub Releases.",
  version: app.getVersion(),
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

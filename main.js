const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("fs/promises");
const path = require("path");

ipcMain.handle("vault:save", async (_event, suggestedName = "password-manager.vault") => {
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

function createWindow() {
  const window = new BrowserWindow({
    width: 1400,
    height: 940,
    minWidth: 1100,
    minHeight: 760,
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
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

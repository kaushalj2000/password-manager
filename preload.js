const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  openVaultFile: () => ipcRenderer.invoke("vault:open"),
  saveVaultFile: (suggestedName) => ipcRenderer.invoke("vault:save", suggestedName),
  readVaultFile: (filePath) => ipcRenderer.invoke("vault:read", filePath),
  writeVaultFile: (filePath, content) => ipcRenderer.invoke("vault:write", filePath, content),
  getExtensionBridgeState: () => ipcRenderer.invoke("extension-bridge:get-state"),
  updateExtensionBridgeState: (payload) => ipcRenderer.invoke("extension-bridge:update-state", payload),
  checkForUpdates: () => ipcRenderer.invoke("app:update-check"),
  downloadUpdate: () => ipcRenderer.invoke("app:update-download"),
  installUpdate: () => ipcRenderer.invoke("app:update-install"),
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("app:update-status", listener);
    return () => ipcRenderer.removeListener("app:update-status", listener);
  },
});

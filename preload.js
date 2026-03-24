const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  openVaultFile: () => ipcRenderer.invoke("vault:open"),
  saveVaultFile: () => ipcRenderer.invoke("vault:save"),
  readVaultFile: (filePath) => ipcRenderer.invoke("vault:read", filePath),
  writeVaultFile: (filePath, content) => ipcRenderer.invoke("vault:write", filePath, content),
});

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  openVaultFile: () => ipcRenderer.invoke("vault:open"),
  saveVaultFile: (suggestedName) => ipcRenderer.invoke("vault:save", suggestedName),
  readVaultFile: (filePath) => ipcRenderer.invoke("vault:read", filePath),
  writeVaultFile: (filePath, content) => ipcRenderer.invoke("vault:write", filePath, content),
});

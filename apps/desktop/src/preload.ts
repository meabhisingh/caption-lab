import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld(
  "captionDesktop",
  Object.freeze({
    getSettings: () => ipcRenderer.invoke("captionlab:get-settings"),
    saveSettings: (settings: unknown) =>
      ipcRenderer.invoke("captionlab:save-settings", settings),
    download: (url: string, suggestedName?: string) =>
      ipcRenderer.invoke("captionlab:download", url, suggestedName),
    onStatus: (callback: (status: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown) =>
        callback(status);
      ipcRenderer.on("captionlab:status", listener);
      return () => ipcRenderer.removeListener("captionlab:status", listener);
    },
  }),
);

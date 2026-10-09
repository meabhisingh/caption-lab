import type { DesktopSnapshot, DesktopSettingsDraft } from "./desktop-types";

export type {
  DesktopServiceState,
  DesktopSettingsDraft,
  DesktopSnapshot,
} from "./desktop-types";

export type DesktopBridge = {
  getSettings(): Promise<DesktopSnapshot>;
  saveSettings(settings: DesktopSettingsDraft): Promise<DesktopSnapshot>;
  download(url: string, suggestedName?: string): Promise<boolean>;
  onStatus(callback: (status: DesktopSnapshot) => void): () => void;
};

const inTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const loadDesktopBridge = async (): Promise<DesktopBridge | null> => {
  if (!inTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  return {
    getSettings: () => invoke<DesktopSnapshot>("get_settings"),
    saveSettings: (settings) =>
      invoke<DesktopSnapshot>("save_settings", { settings }),
    download: (sourceUrl, suggestedName) =>
      invoke<boolean>("download_export", { sourceUrl, suggestedName }),
    onStatus: (callback) => {
      let active = true;
      let unlisten = () => {};
      void listen<DesktopSnapshot>("captionlab:status", (event) => {
        callback(event.payload);
      }).then((stop) => {
        if (active) unlisten = stop;
        else stop();
      });
      return () => {
        active = false;
        unlisten();
      };
    },
  };
};

export type DesktopServiceState =
  "needs-setup" | "starting" | "ready" | "error";

export type DesktopSnapshot = {
  configured: boolean;
  state: DesktopServiceState;
  error: string | null;
  savedFields: {
    GROQ_API_KEY: boolean;
  };
  values: {
    GPU_FRAME_ACCELERATION: boolean;
    dataDir: string;
  };
};

export type DesktopSettingsDraft = {
  GROQ_API_KEY?: string;
  GPU_FRAME_ACCELERATION?: boolean;
};

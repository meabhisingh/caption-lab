type CaptionDesktopFieldKey =
  | "DATABASE_URL"
  | "GROQ_API_KEY"
  | "REDIS_URL"
  | "AWS_ACCESS_KEY"
  | "AWS_SECRET_KEY"
  | "STORAGE_REGION"
  | "STORAGE_BUCKET";

interface CaptionDesktopSnapshot {
  configured: boolean;
  state: "needs-setup" | "starting" | "ready" | "error";
  error: string | null;
  savedFields: Record<CaptionDesktopFieldKey, boolean>;
  values: {
    STORAGE_REGION: string;
    STORAGE_BUCKET: string;
    GPU_FRAME_ACCELERATION: boolean;
  };
}

type CaptionDesktopSettingsInput = Partial<
  Record<CaptionDesktopFieldKey, string>
> & {
  GPU_FRAME_ACCELERATION?: boolean;
};

interface CaptionDesktopBridge {
  getSettings(): Promise<CaptionDesktopSnapshot>;
  saveSettings(
    settings: CaptionDesktopSettingsInput,
  ): Promise<CaptionDesktopSnapshot>;
  download(url: string, suggestedName?: string): Promise<boolean>;
  onStatus(callback: (status: CaptionDesktopSnapshot) => void): () => void;
}

interface Window {
  captionDesktop?: CaptionDesktopBridge;
}

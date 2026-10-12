// Editor-only preferences. None of this reaches the exported overlay; it is
// kept in localStorage so the workspace looks the same next time.

export const PREVIEW_BACKDROPS = [
  "transparent",
  "dark",
  "light",
  "green",
  "video",
] as const;
export type PreviewBackdrop = (typeof PREVIEW_BACKDROPS)[number];

export const SAFE_ZONES = ["none", "tiktok", "reels", "shorts"] as const;
export type SafeZone = (typeof SAFE_ZONES)[number];

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export const TIMELINE_HEIGHT = { min: 120, max: 560, initial: 190 } as const;
export const TIMELINE_ZOOM = { min: 1, max: 12, initial: 1 } as const;

/**
 * How far the timeline of a clip can zoom in. Zoom is a multiple of "the whole
 * clip fits", so a long clip needs more of it before single words get wide
 * enough to read and drag: the view can always narrow to about four seconds.
 */
export const maxTimelineZoom = (durationSeconds: number) =>
  Math.max(TIMELINE_ZOOM.max, Math.ceil(durationSeconds / 4));

// Above any clip's own limit; only guards the stored value.
const STORED_ZOOM_LIMIT = 5000;

export type PreviewSettings = {
  /** What is drawn behind the captions in the editor. */
  backdrop: PreviewBackdrop;
  /** Outline of the area a platform covers with its own buttons and text. */
  safeZone: SafeZone;
  showWaveform: boolean;
  /** Height of the timeline in pixels. */
  timelineHeight: number;
  /** Horizontal zoom of the timeline; 1 fits the whole clip. */
  timelineZoom: number;
  playbackRate: number;
};

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  backdrop: "transparent",
  safeZone: "none",
  showWaveform: true,
  timelineHeight: TIMELINE_HEIGHT.initial,
  timelineZoom: TIMELINE_ZOOM.initial,
  playbackRate: 1,
};

const STORAGE_KEY = "captionlab:preview-settings";

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

export const loadPreviewSettings = (): PreviewSettings => {
  if (typeof window === "undefined") return DEFAULT_PREVIEW_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const stored = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
    const defaults = DEFAULT_PREVIEW_SETTINGS;
    return {
      backdrop: PREVIEW_BACKDROPS.includes(stored.backdrop as PreviewBackdrop)
        ? (stored.backdrop as PreviewBackdrop)
        : defaults.backdrop,
      safeZone: SAFE_ZONES.includes(stored.safeZone as SafeZone)
        ? (stored.safeZone as SafeZone)
        : defaults.safeZone,
      showWaveform:
        typeof stored.showWaveform === "boolean"
          ? stored.showWaveform
          : defaults.showWaveform,
      timelineHeight: clamp(
        stored.timelineHeight,
        TIMELINE_HEIGHT.min,
        TIMELINE_HEIGHT.max,
        defaults.timelineHeight,
      ),
      timelineZoom: clamp(
        stored.timelineZoom,
        TIMELINE_ZOOM.min,
        STORED_ZOOM_LIMIT,
        defaults.timelineZoom,
      ),
      playbackRate: PLAYBACK_RATES.includes(
        stored.playbackRate as (typeof PLAYBACK_RATES)[number],
      )
        ? (stored.playbackRate as number)
        : defaults.playbackRate,
    };
  } catch {
    return DEFAULT_PREVIEW_SETTINGS;
  }
};

export const savePreviewSettings = (settings: PreviewSettings) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be full or disabled; the settings then last for the session.
  }
};

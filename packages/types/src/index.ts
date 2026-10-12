export type CaptionWord = { text: string; start: number; end: number };

export type CaptionTemplateId =
  | "viral"
  | "clean"
  | "neon"
  | "boxed"
  | "karaoke"
  | "impact"
  | "highlighter"
  | "spotlight"
  | "bubble"
  | "cinema"
  | "typewriter"
  | "comic"
  | "whisper"
  | "marker";

export type CaptionShadow = "none" | "soft" | "hard" | "glow";
export type CaptionAnimation = "pop" | "rise" | "none";
export type CaptionAlign = "left" | "center" | "right";

export type CaptionStyle = {
  /** Styles saved before version 2 lack this field and are migrated on read. */
  version: 2;
  templateId: CaptionTemplateId;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  uppercase: boolean;
  /** In em. */
  letterSpacing: number;
  textColor: string;
  /** Text color of the word being spoken. */
  activeColor: string;
  /** Box drawn behind the word being spoken. */
  activeBackgroundColor: string;
  activeBackgroundOpacity: number;
  /** Opacity of the words that are not being spoken. */
  inactiveOpacity: number;
  strokeColor: string;
  strokeWidth: number;
  /** Box drawn behind the whole caption line. */
  backgroundColor: string;
  backgroundOpacity: number;
  borderRadius: number;
  shadow: CaptionShadow;
  animation: CaptionAnimation;
  maxWords: number;
  /** Horizontal center of the caption block, in percent of the canvas width. */
  positionX: number;
  /** Top edge of the caption block, in percent of the canvas height. */
  positionY: number;
  /** Widest the caption block may get, in percent of the canvas width. */
  maxWidth: number;
  textAlign: CaptionAlign;
  /** Opacity of the whole caption block. */
  opacity: number;
  /** In degrees. */
  rotation: number;
};

export type ProjectStatus =
  "UPLOADED" | "PROCESSING" | "READY" | "EXPORTING" | "COMPLETE" | "FAILED";

export type CaptionProject = {
  id: string;
  fileName: string;
  mediaType: "AUDIO" | "VIDEO";
  status: ProjectStatus;
  durationSeconds: number | null;
  width: number;
  height: number;
  fps: number;
  renderProgress: number;
  words: CaptionWord[];
  style: CaptionStyle;
  sourceUrl: string | null;
  /** Normalized speech audio, available once transcription has finished. */
  audioUrl: string | null;
  exportUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CaptionJob =
  | { kind: "transcribe"; projectId: string }
  | { kind: "export"; projectId: string };

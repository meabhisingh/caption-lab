export type CaptionWord = { text: string; start: number; end: number };

export type CaptionTemplateId =
  "viral" | "clean" | "neon" | "boxed" | "karaoke";

export type CaptionStyle = {
  templateId: CaptionTemplateId;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textColor: string;
  activeColor: string;
  strokeColor: string;
  strokeWidth: number;
  backgroundColor: string;
  backgroundOpacity: number;
  borderRadius: number;
  maxWords: number;
  uppercase: boolean;
  positionY: number;
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
  exportUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CaptionJob =
  | { kind: "transcribe"; projectId: string }
  | { kind: "export"; projectId: string };

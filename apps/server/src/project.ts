import {
  normalizeCaptionStyle,
  sanitizeWords,
} from "@caption-generator/captions";
import type { CaptionProject } from "@caption-generator/types";
import { getDownloadUrl } from "./storage";

type ProjectRecord = {
  id: string;
  fileName: string;
  mediaType: "AUDIO" | "VIDEO";
  status: CaptionProject["status"];
  durationSeconds: number | null;
  width: number;
  height: number;
  fps: number;
  renderProgress: number;
  transcript: unknown;
  captionStyle: unknown;
  sourceKey: string;
  audioKey: string | null;
  exportKey: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** The words of a stored transcript, cleaned up for the renderer. */
export const transcriptWords = (
  transcript: unknown,
  durationSeconds: number | null,
) =>
  sanitizeWords(
    (transcript as { words?: unknown } | null)?.words,
    durationSeconds,
  );

export const serializeProject = async (
  project: ProjectRecord,
): Promise<CaptionProject> => {
  const [sourceUrl, audioUrl, exportUrl] = await Promise.all([
    getDownloadUrl(project.sourceKey),
    project.audioKey ? getDownloadUrl(project.audioKey) : null,
    project.exportKey
      ? getDownloadUrl(
          project.exportKey,
          `${project.fileName.replace(/\.[^.]+$/, "")}-captions.webm`,
        )
      : null,
  ]);

  return {
    id: project.id,
    fileName: project.fileName,
    mediaType: project.mediaType,
    status: project.status,
    durationSeconds: project.durationSeconds,
    width: project.width,
    height: project.height,
    fps: project.fps,
    renderProgress: project.renderProgress,
    words: transcriptWords(project.transcript, project.durationSeconds),
    style: normalizeCaptionStyle(project.captionStyle),
    sourceUrl,
    audioUrl,
    exportUrl,
    error: project.error,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
};

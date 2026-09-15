import type {
  CaptionProject,
  CaptionStyle,
  CaptionWord,
} from "@caption-generator/types";
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
  exportKey: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export const serializeProject = async (
  project: ProjectRecord,
): Promise<CaptionProject> => {
  const [sourceUrl, exportUrl] = await Promise.all([
    getDownloadUrl(project.sourceKey),
    project.exportKey
      ? getDownloadUrl(
          project.exportKey,
          `${project.fileName.replace(/\.[^.]+$/, "")}-captions.webm`,
        )
      : null,
  ]);

  const transcript = project.transcript as { words?: CaptionWord[] } | null;
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
    words: transcript?.words ?? [],
    style: project.captionStyle as CaptionStyle,
    sourceUrl,
    exportUrl,
    error: project.error,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
};

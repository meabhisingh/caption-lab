import type { CaptionStyle, ProjectStatus } from "@caption-generator/types";

export type CaptionProjectRecord = {
  id: string;
  fileName: string;
  contentType: string;
  mediaType: "AUDIO" | "VIDEO";
  status: ProjectStatus;
  sourceKey: string;
  audioKey: string | null;
  transcriptKey: string | null;
  transcript: unknown;
  captionStyle: unknown;
  durationSeconds: number | null;
  width: number;
  height: number;
  fps: number;
  renderProgress: number;
  exportKey: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateProjectInput = {
  id: string;
  fileName: string;
  contentType: string;
  mediaType: "AUDIO" | "VIDEO";
  sourceKey: string;
  captionStyle: CaptionStyle;
};

export type ProjectPatch = {
  status?: ProjectStatus;
  error?: string | null;
  audioKey?: string | null;
  transcriptKey?: string | null;
  transcript?: unknown;
  durationSeconds?: number | null;
  renderProgress?: number;
  exportKey?: string | null;
  captionStyle?: unknown;
};

export type ProjectStore = {
  create(input: CreateProjectInput): Promise<CaptionProjectRecord>;
  findById(id: string): Promise<CaptionProjectRecord | null>;
  requireById(id: string): Promise<CaptionProjectRecord>;
  update(id: string, patch: ProjectPatch): Promise<CaptionProjectRecord>;
  close(): Promise<void>;
};

export const openProjectStore = async (): Promise<ProjectStore> => {
  const { env } = await import("@caption-generator/env/server");
  if (env.CAPTIONLAB_RUNTIME === "desktop") {
    const { createSqliteProjectStore } = await import("./sqlite-store");
    return createSqliteProjectStore();
  }
  const { createPrismaProjectStore } = await import("./prisma-store");
  return createPrismaProjectStore();
};

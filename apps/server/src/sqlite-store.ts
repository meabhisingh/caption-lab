import type { SQLOutputValue } from "node:sqlite";
import { closeLocalDatabase, getLocalDatabase } from "./sqlite";
import type {
  CaptionProjectRecord,
  CreateProjectInput,
  ProjectPatch,
  ProjectStore,
} from "./project-store";
import type { ProjectStatus } from "@caption-generator/types";

const text = (value: SQLOutputValue | undefined) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint")
    return String(value);
  return null;
};

const numberOrNull = (value: SQLOutputValue | undefined) => {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return null;
};

const parseJson = (value: SQLOutputValue | undefined) => {
  const raw = text(value);
  if (!raw) return null;
  return JSON.parse(raw) as unknown;
};

const rowToProject = (
  row: Record<string, SQLOutputValue>,
): CaptionProjectRecord => {
  const mediaType = text(row.media_type);
  const status = text(row.status);
  const createdAt = text(row.created_at);
  const updatedAt = text(row.updated_at);
  if (
    (mediaType !== "AUDIO" && mediaType !== "VIDEO") ||
    !status ||
    !createdAt ||
    !updatedAt
  ) {
    throw new Error("Caption project row is incomplete.");
  }
  return {
    id: text(row.id) ?? "",
    fileName: text(row.file_name) ?? "",
    contentType: text(row.content_type) ?? "application/octet-stream",
    mediaType,
    status: status as ProjectStatus,
    sourceKey: text(row.source_key) ?? "",
    audioKey: text(row.audio_key),
    transcriptKey: text(row.transcript_key),
    transcript: parseJson(row.transcript),
    captionStyle: parseJson(row.caption_style) ?? {},
    durationSeconds: numberOrNull(row.duration_seconds),
    width: numberOrNull(row.width) ?? 1080,
    height: numberOrNull(row.height) ?? 1920,
    fps: numberOrNull(row.fps) ?? 30,
    renderProgress: numberOrNull(row.render_progress) ?? 0,
    exportKey: text(row.export_key),
    error: text(row.error),
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
  };
};

const findRow = (id: string) => {
  const row = getLocalDatabase()
    .prepare("SELECT * FROM caption_project WHERE id = ?")
    .get(id);
  return row ? rowToProject(row) : null;
};

export const createSqliteProjectStore = (): ProjectStore => ({
  create: async (input: CreateProjectInput) => {
    const now = new Date().toISOString();
    getLocalDatabase()
      .prepare(
        `INSERT INTO caption_project (
          id, file_name, content_type, media_type, status, source_key,
          caption_style, width, height, fps, render_progress, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'UPLOADED', ?, ?, 1080, 1920, 30, 0, ?, ?)`,
      )
      .run(
        input.id,
        input.fileName,
        input.contentType,
        input.mediaType,
        input.sourceKey,
        JSON.stringify(input.captionStyle),
        now,
        now,
      );
    const project = findRow(input.id);
    if (!project) throw new Error("Could not store the caption project.");
    return project;
  },
  findById: async (id) => findRow(id),
  requireById: async (id) => {
    const project = findRow(id);
    if (!project) throw new Error("Project not found.");
    return project;
  },
  update: async (id, patch: ProjectPatch) => {
    const assignments: string[] = [];
    const values: Array<string | number | null> = [];
    const set = (column: string, value: string | number | null) => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };
    if (patch.status !== undefined) set("status", patch.status);
    if (patch.error !== undefined) set("error", patch.error);
    if (patch.audioKey !== undefined) set("audio_key", patch.audioKey);
    if (patch.transcriptKey !== undefined)
      set("transcript_key", patch.transcriptKey);
    if (patch.transcript !== undefined) {
      set(
        "transcript",
        patch.transcript === null ? null : JSON.stringify(patch.transcript),
      );
    }
    if (patch.durationSeconds !== undefined)
      set("duration_seconds", patch.durationSeconds);
    if (patch.renderProgress !== undefined)
      set("render_progress", patch.renderProgress);
    if (patch.exportKey !== undefined) set("export_key", patch.exportKey);
    if (patch.captionStyle !== undefined) {
      set(
        "caption_style",
        patch.captionStyle === null ? null : JSON.stringify(patch.captionStyle),
      );
    }
    set("updated_at", new Date().toISOString());
    values.push(id);
    const result = getLocalDatabase()
      .prepare(
        `UPDATE caption_project SET ${assignments.join(", ")} WHERE id = ?`,
      )
      .run(...values);
    if (result.changes === 0) throw new Error("Project not found.");
    const project = findRow(id);
    if (!project) throw new Error("Project not found.");
    return project;
  },
  close: async () => {
    closeLocalDatabase();
  },
});

import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { env } from "@caption-generator/env/server";

let database: DatabaseSync | null = null;

const schema = `
CREATE TABLE IF NOT EXISTS caption_project (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  media_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'UPLOADED',
  source_key TEXT NOT NULL,
  audio_key TEXT,
  transcript_key TEXT,
  transcript TEXT,
  caption_style TEXT NOT NULL,
  duration_seconds REAL,
  width INTEGER NOT NULL DEFAULT 1080,
  height INTEGER NOT NULL DEFAULT 1920,
  fps INTEGER NOT NULL DEFAULT 30,
  render_progress INTEGER NOT NULL DEFAULT 0,
  export_key TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS object_meta (
  key TEXT PRIMARY KEY,
  content_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS caption_job (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  project_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL,
  available_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS caption_job_status_idx
  ON caption_job (status, available_at, created_at);
`;

export const localDataDir = () => {
  if (env.CAPTIONLAB_RUNTIME !== "desktop") {
    throw new Error("Local data is only available in the desktop runtime.");
  }
  return env.CAPTIONLAB_DATA_DIR;
};

export const localFilesDir = () => join(localDataDir(), "files");

export const getLocalDatabase = () => {
  if (database) return database;
  const dataDir = localDataDir();
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(localFilesDir(), { recursive: true });
  const next = new DatabaseSync(join(dataDir, "captionlab.sqlite"));
  next.exec("PRAGMA journal_mode = WAL");
  next.exec("PRAGMA busy_timeout = 5000");
  next.exec(schema);
  database = next;
  return next;
};

export const closeLocalDatabase = () => {
  database?.close();
  database = null;
};

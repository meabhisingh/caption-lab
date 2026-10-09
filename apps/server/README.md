# CaptionLab API

From the workspace root, run `pnpm dev`. This starts the Hono API and BullMQ worker on `http://localhost:4000`.

The worker handles both `transcribe` jobs (FFmpeg + Groq Whisper) and `export` jobs (Remotion VP9 alpha rendering).

Set `CAPTIONLAB_RUNTIME=desktop` and `CAPTIONLAB_DATA_DIR` to run without Postgres, Redis, or S3. That mode stores projects in SQLite, files on disk, and the job queue in SQLite. The Tauri app sets those variables itself. The hosted API leaves `CAPTIONLAB_RUNTIME` unset and keeps using `DATABASE_URL`, `REDIS_URL`, and the storage credentials.

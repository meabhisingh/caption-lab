# CaptionLab API

From the workspace root, run `pnpm dev`. This starts the Hono API and BullMQ worker on `http://localhost:4000`.

The worker handles both `transcribe` jobs (FFmpeg + Groq Whisper) and `export` jobs (Remotion VP9 alpha rendering).

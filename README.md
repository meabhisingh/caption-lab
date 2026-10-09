# CaptionLab

CaptionLab turns uploaded audio or video into a transparent, word-synced caption overlay.

## Pipeline

1. The Next.js editor uploads an audio or video file to the Hono API.
2. The hosted API stores the source privately in S3 and queues a BullMQ job in Redis. The desktop app stores the source on the local disk and queues the job in a local SQLite table.
3. The worker uses FFmpeg to extract/normalize mono audio.
4. Groq Whisper returns `verbose_json` with word timestamps.
5. Postgres stores the transcript and selected caption style.
6. The shared Remotion composition powers the browser preview and renders a silent VP9 WebM with alpha.

## Workspace

- `apps/web` — Next.js 16 editor and Remotion Player preview
- `apps/server` — Hono API, worker, FFmpeg, Groq, and Remotion rendering. Hosted mode uses Postgres, Redis, and S3. Desktop mode uses SQLite, a local file folder, and an on-disk job queue.
- `apps/desktop` — Tauri shell that runs the editor and API on the local machine
- `packages/captions` — shared word-highlight composition and five style presets
- `packages/db` — Prisma client, schema, and migrations
- `packages/queue` — typed BullMQ queue
- `packages/types` — shared API, project, word, and style contracts

## Local setup

Copy `.env.example` to `apps/server/.env`, and copy `apps/web/.env.example` to `apps/web/.env.local`.

```bash
pnpm install
pnpm --filter @caption-generator/db exec prisma generate --config prisma7.config.ts
pnpm --filter @caption-generator/db exec prisma migrate deploy --config prisma7.config.ts
pnpm dev
```

The editor runs at `http://localhost:3000`; the API and worker run at `http://localhost:4000`.

## Environment variables

Put the server values in `apps/server/.env`. The same file is used by local development and Docker Compose.

| Variable             | Required | Purpose                                                       |
| -------------------- | -------- | ------------------------------------------------------------- |
| `DATABASE_URL`       | Yes      | PostgreSQL connection string used by Prisma                   |
| `GROQ_API_KEY`       | Yes      | Groq API key for Whisper speech-to-text                       |
| `REDIS_URL`          | Yes      | Redis connection string used by BullMQ                        |
| `AWS_ACCESS_KEY`     | Yes      | S3-compatible storage access key                              |
| `AWS_SECRET_KEY`     | Yes      | S3-compatible storage secret key                              |
| `STORAGE_REGION`     | Yes      | Storage bucket region                                         |
| `STORAGE_BUCKET`     | Yes      | Private bucket for uploads, transcripts, and renders          |
| `WORKER_CONCURRENCY` | No       | Jobs processed in parallel; defaults to `2`, desktop uses `1` |
| `REMOTION_GL`        | No       | Set to `angle` to accelerate Chromium frame rendering         |
| `PORT`               | No       | API port; defaults to `4000`                                  |
| `CORS_ORIGIN`        | No       | Allowed web origin; defaults to `http://localhost:3000`       |
| `NODE_ENV`           | No       | Runtime mode; Compose sets this to `production`               |

The web app has one build-time variable: `NEXT_PUBLIC_SERVER_URL`. It defaults to `http://localhost:4000` in Compose. Set it to the browser-accessible API URL when deploying to another host. Never put server credentials in a `NEXT_PUBLIC_*` variable.

The desktop shell sets `CAPTIONLAB_RUNTIME=desktop` and `CAPTIONLAB_DATA_DIR` itself. In that mode the API does not read `DATABASE_URL`, `REDIS_URL`, or the storage credentials. It opens `captionlab.sqlite` and a `files` directory inside the data folder, and it serves media from `http://127.0.0.1`. The only secret the desktop app asks for is `GROQ_API_KEY`.

## Docker Compose

Create the server environment file once:

```powershell
Copy-Item .env.example apps/server/.env
```

Fill in the seven required values, then build and start the complete app:

```bash
docker compose up --build
```

Compose starts the web app on `http://localhost:3000` and the API/worker on `http://localhost:4000`. The server waits for its health check, applies pending Prisma migrations, and then starts the API and render worker. PostgreSQL, Redis, Groq, and S3 remain managed external services and are not duplicated as local containers.

For a non-local deployment, create a root `.env` containing the public URLs before building:

```dotenv
NEXT_PUBLIC_SERVER_URL=https://api.example.com
```

Also set `CORS_ORIGIN=https://captions.example.com` in `apps/server/.env`.

## Desktop application

The desktop app is a Tauri shell. It opens the Next.js editor in a system webview and starts the same Hono API with `CAPTIONLAB_RUNTIME=desktop`. PostgreSQL, Redis, and S3 are not used. SQLite, uploaded media, transcripts, and rendered overlays stay in the operating-system app data folder. The job queue is a table in that same database, processed in-process. Groq remains the speech-to-text service and needs network access.

Rust and the Tauri CLI are required. On Windows, install them with `winget install Rustlang.Rustup`, then open a new terminal so `cargo` is on `PATH`.

Run the desktop app from source:

```bash
pnpm desktop:dev
```

The editor listens on `http://127.0.0.1:43110` and the API on `http://127.0.0.1:43111`. On first launch, open Settings and enter a Groq API key. CaptionLab stores that key in the operating-system credential manager. Settings also includes an optional GPU frame acceleration switch, which enables Chromium ANGLE while keeping transparent VP9 encoding on the CPU. The desktop worker processes one job at a time.

Build an unpacked application:

```bash
pnpm desktop:pack
```

Build the platform installer:

```bash
pnpm desktop:dist
```

Packaging is platform-specific because FFmpeg, Remotion, and Chrome include native binaries. Build Windows installers on Windows and build macOS/Linux artifacts on their corresponding platforms. The installer bundles the Next.js server and the API into the Tauri resource directory.

## Output

Exports are 1080×1920 VP9 WebM files with `alpha_mode: 1` and no audio stream. On the hosted API, the source, normalized audio, `verbose.json`, and final overlay remain private S3 objects, and responses use one-hour signed URLs. On the desktop app those objects stay in the local data folder, and the API serves them directly.

Remotion may require a company license depending on the organization using the app. Review the current licensing terms before deploying commercially.

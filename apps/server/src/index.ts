import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import {
  CAPTION_ALIGNMENTS,
  CAPTION_ANIMATIONS,
  CAPTION_LIMITS,
  CAPTION_SHADOWS,
  CAPTION_TEMPLATE_IDS,
  DEFAULT_CAPTION_STYLE,
  MAX_FONT_FAMILY_LENGTH,
  WORD_LIMITS,
  normalizeCaptionStyle,
  sameCaptionStyle,
  sanitizeWords,
  wordsToText,
} from "@caption-generator/captions";
import { env } from "@caption-generator/env/server";
import type { CaptionWord } from "@caption-generator/types";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { z } from "zod";
import type { CaptionProjectRecord, ProjectPatch } from "./project-store";
import { openProjectStore } from "./project-store";
import { serializeProject, transcriptWords } from "./project";
import {
  attachmentDisposition,
  getObjectBuffer,
  putObject,
  readStoredObject,
} from "./storage";
import { startCaptionWorker } from "./worker";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const store = await openProjectStore();
const jobs = await startCaptionWorker(store);
const app = new Hono();

if (env.CAPTIONLAB_RUNTIME === "desktop") {
  console.log(`Desktop runtime using local data at ${env.CAPTIONLAB_DATA_DIR}`);
}

app.use(logger());
app.use(
  "/api/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Range"],
    exposeHeaders: [
      "Accept-Ranges",
      "Content-Range",
      "Content-Length",
      "Content-Disposition",
    ],
  }),
);

// The JSON routes of a project. The largest allowed transcript is under 1 MB;
// the upload route is not matched and keeps its own, larger limit.
app.use(
  "/api/projects/:id/*",
  bodyLimit({
    maxSize: 4 * 1024 * 1024,
    onError: (context) =>
      context.json({ error: "The request is too large." }, 413),
  }),
);

app.get("/health", (context) =>
  context.json({ ok: true, runtime: env.CAPTIONLAB_RUNTIME }),
);

app.get("/api/media", async (context) => {
  if (env.CAPTIONLAB_RUNTIME !== "desktop") {
    return context.json({ error: "Not found." }, 404);
  }
  const key = context.req.query("key");
  if (!key) return context.json({ error: "Missing file." }, 400);
  let file: Awaited<ReturnType<typeof readStoredObject>>;
  try {
    file = await readStoredObject(key);
  } catch {
    return context.json({ error: "File not found." }, 404);
  }

  const headers: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Type": file.contentType,
  };
  const downloadName = context.req.query("download");
  if (downloadName)
    headers["Content-Disposition"] = attachmentDisposition(downloadName);

  const total = file.body.length;
  const range = context.req.header("range");
  if (!range) {
    headers["Content-Length"] = String(total);
    return context.body(new Uint8Array(file.body), 200, headers);
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  const start = match?.[1] ? Number(match[1]) : 0;
  const end = match?.[2] ? Number(match[2]) : total - 1;
  if (!match || start > end || start >= total || end >= total) {
    headers["Content-Range"] = `bytes */${total}`;
    return context.body(null, 416, headers);
  }
  headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
  headers["Content-Length"] = String(end - start + 1);
  return context.body(
    new Uint8Array(file.body.subarray(start, end + 1)),
    206,
    headers,
  );
});

app.post("/api/projects", async (context) => {
  const form = await context.req.formData();
  const uploaded = form.get("file");
  if (!(uploaded instanceof File))
    return context.json({ error: "Choose an audio or video file." }, 400);
  if (uploaded.size === 0)
    return context.json({ error: "The selected file is empty." }, 400);
  if (uploaded.size > MAX_UPLOAD_BYTES)
    return context.json({ error: "Files must be 100 MB or smaller." }, 413);

  const mediaType = uploaded.type.startsWith("video/")
    ? "VIDEO"
    : uploaded.type.startsWith("audio/")
      ? "AUDIO"
      : null;
  if (!mediaType)
    return context.json(
      { error: "Only audio and video files are supported." },
      415,
    );

  const id = randomUUID();
  const safeName =
    uploaded.name.replace(/[^a-z0-9._-]+/gi, "-").slice(-120) || "upload";
  const sourceKey = `projects/${id}/source-${safeName}`;
  await putObject(
    sourceKey,
    new Uint8Array(await uploaded.arrayBuffer()),
    uploaded.type || "application/octet-stream",
  );
  const project = await store.create({
    id,
    fileName: uploaded.name,
    contentType: uploaded.type || "application/octet-stream",
    mediaType,
    sourceKey,
    captionStyle: DEFAULT_CAPTION_STYLE,
  });
  await jobs.enqueue(
    { kind: "transcribe", projectId: id },
    { jobId: `transcribe-${id}` },
  );
  return context.json(await serializeProject(project), 201);
});

app.get("/api/projects/:id", async (context) => {
  const project = await store.findById(context.req.param("id"));
  if (!project) return context.json({ error: "Project not found." }, 404);
  return context.json(await serializeProject(project));
});

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);
const within = (limits: { min: number; max: number }) =>
  z.number().min(limits.min).max(limits.max);

// The fields added in version 2 are optional so a style saved by an older
// editor is still accepted; normalizeCaptionStyle fills them in.
const styleSchema = z.object({
  version: z.literal(2).optional(),
  templateId: z.enum(CAPTION_TEMPLATE_IDS),
  fontFamily: z.string().trim().min(1).max(MAX_FONT_FAMILY_LENGTH),
  fontSize: within(CAPTION_LIMITS.fontSize),
  fontWeight: within(CAPTION_LIMITS.fontWeight),
  italic: z.boolean().optional(),
  uppercase: z.boolean(),
  letterSpacing: within(CAPTION_LIMITS.letterSpacing).optional(),
  textColor: hexColor,
  activeColor: hexColor,
  activeBackgroundColor: hexColor.optional(),
  activeBackgroundOpacity: within(
    CAPTION_LIMITS.activeBackgroundOpacity,
  ).optional(),
  inactiveOpacity: within(CAPTION_LIMITS.inactiveOpacity).optional(),
  strokeColor: z.string().max(32),
  strokeWidth: within(CAPTION_LIMITS.strokeWidth),
  backgroundColor: hexColor,
  backgroundOpacity: within(CAPTION_LIMITS.backgroundOpacity),
  borderRadius: within(CAPTION_LIMITS.borderRadius),
  shadow: z.enum(CAPTION_SHADOWS).optional(),
  animation: z.enum(CAPTION_ANIMATIONS).optional(),
  maxWords: within(CAPTION_LIMITS.maxWords).int(),
  positionX: within(CAPTION_LIMITS.positionX).optional(),
  // Version 1 styles used a different scale that reaches a little higher.
  positionY: z.number().min(CAPTION_LIMITS.positionY.min).max(100),
  maxWidth: within(CAPTION_LIMITS.maxWidth).optional(),
  textAlign: z.enum(CAPTION_ALIGNMENTS).optional(),
  opacity: within(CAPTION_LIMITS.opacity).optional(),
  rotation: within(CAPTION_LIMITS.rotation).optional(),
});

const VERSION_2_FIELDS = [
  "italic",
  "letterSpacing",
  "activeBackgroundColor",
  "activeBackgroundOpacity",
  "inactiveOpacity",
  "shadow",
  "animation",
  "positionX",
  "maxWidth",
  "textAlign",
  "opacity",
  "rotation",
] as const satisfies ReadonlyArray<keyof z.infer<typeof styleSchema>>;

const wordsSchema = z.object({
  words: z
    .array(
      z.object({
        text: z.string().max(WORD_LIMITS.textLength * 4),
        start: z.number().finite(),
        end: z.number().finite(),
      }),
    )
    .max(WORD_LIMITS.count),
});

const readJson = async (request: { json: () => Promise<unknown> }) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

// Once the captions change, a finished or failed export no longer matches.
const afterCaptionEdit = (project: CaptionProjectRecord): ProjectPatch =>
  project.status === "COMPLETE" || project.status === "FAILED"
    ? { status: "READY", error: null, exportKey: null, renderProgress: 0 }
    : {};

const EXPORTING_MESSAGE = "Wait for the export to finish before editing.";

app.patch("/api/projects/:id/style", async (context) => {
  const parsed = styleSchema.safeParse(await readJson(context.req));
  if (!parsed.success)
    return context.json(
      { error: "Invalid caption style.", details: parsed.error.flatten() },
      400,
    );
  const existing = await store.findById(context.req.param("id"));
  if (!existing) return context.json({ error: "Project not found." }, 404);
  if (existing.status === "EXPORTING")
    return context.json({ error: EXPORTING_MESSAGE }, 409);
  // A body that carries version 2 fields is version 2 even without saying so;
  // reading it as version 1 would rescale its position on every save.
  const captionStyle = normalizeCaptionStyle(
    VERSION_2_FIELDS.some((field) => parsed.data[field] !== undefined)
      ? { ...parsed.data, version: 2 }
      : parsed.data,
  );
  if (
    sameCaptionStyle(captionStyle, normalizeCaptionStyle(existing.captionStyle))
  )
    return context.json(await serializeProject(existing));
  // A failed transcription stays failed; there is nothing to export yet.
  const project = await store.update(existing.id, {
    captionStyle,
    ...(existing.transcript ? afterCaptionEdit(existing) : {}),
  });
  return context.json(await serializeProject(project));
});

const saveWords = async (
  project: CaptionProjectRecord,
  words: CaptionWord[],
) => {
  // Saving what is already there must not discard a finished export.
  const current = transcriptWords(project.transcript, project.durationSeconds);
  if (
    current.length === words.length &&
    current.every((word, index) => {
      const next = words[index];
      return (
        next !== undefined &&
        word.text === next.text &&
        word.start === next.start &&
        word.end === next.end
      );
    })
  )
    return project;
  const transcript = (project.transcript ?? {}) as Record<string, unknown>;
  return store.update(project.id, {
    transcript: { ...transcript, text: wordsToText(words), words },
    ...afterCaptionEdit(project),
  });
};

app.patch("/api/projects/:id/words", async (context) => {
  const parsed = wordsSchema.safeParse(await readJson(context.req));
  if (!parsed.success)
    return context.json(
      { error: "Invalid caption words.", details: parsed.error.flatten() },
      400,
    );
  const existing = await store.findById(context.req.param("id"));
  if (!existing) return context.json({ error: "Project not found." }, 404);
  if (existing.status === "EXPORTING")
    return context.json({ error: EXPORTING_MESSAGE }, 409);
  if (!existing.transcript || !existing.durationSeconds)
    return context.json(
      { error: "Wait for transcription to finish before editing." },
      409,
    );
  const words = sanitizeWords(parsed.data.words, existing.durationSeconds);
  if (words.length === 0)
    return context.json({ error: "Keep at least one word." }, 400);
  return context.json(await serializeProject(await saveWords(existing, words)));
});

app.post("/api/projects/:id/words/reset", async (context) => {
  const existing = await store.findById(context.req.param("id"));
  if (!existing) return context.json({ error: "Project not found." }, 404);
  if (existing.status === "EXPORTING")
    return context.json({ error: EXPORTING_MESSAGE }, 409);
  if (!existing.transcriptKey || !existing.durationSeconds)
    return context.json(
      { error: "The original transcript is not available." },
      409,
    );
  let original: unknown;
  try {
    original = JSON.parse(
      (await getObjectBuffer(existing.transcriptKey)).toString("utf8"),
    );
  } catch {
    return context.json(
      { error: "The original transcript could not be read." },
      500,
    );
  }
  const words = transcriptWords(original, existing.durationSeconds);
  if (words.length === 0)
    return context.json({ error: "The original transcript is empty." }, 409);
  return context.json(await serializeProject(await saveWords(existing, words)));
});

app.post("/api/projects/:id/export", async (context) => {
  const id = context.req.param("id");
  const project = await store.findById(id);
  if (!project) return context.json({ error: "Project not found." }, 404);
  if (!project.transcript || !project.durationSeconds) {
    return context.json(
      { error: "Wait for transcription to finish before exporting." },
      409,
    );
  }
  if (project.status === "EXPORTING")
    return context.json(await serializeProject(project), 202);
  const updated = await store.update(id, {
    status: "EXPORTING",
    renderProgress: 0,
    exportKey: null,
    error: null,
  });
  await jobs.enqueue(
    { kind: "export", projectId: id },
    { jobId: `export-${id}-${Date.now()}` },
  );
  return context.json(await serializeProject(updated), 202);
});

app.onError((error, context) => {
  console.error(error);
  return context.json(
    {
      error:
        env.NODE_ENV === "development"
          ? error.message
          : "Something went wrong.",
    },
    500,
  );
});

const hostname = env.CAPTIONLAB_RUNTIME === "desktop" ? "127.0.0.1" : undefined;
const server = serve(
  { fetch: app.fetch, port: env.PORT, hostname },
  ({ port }) => {
    console.log(
      `Caption API running on http://${hostname ?? "localhost"}:${port}`,
    );
  },
);

const shutdown = async () => {
  server.close();
  await jobs.close();
  await store.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

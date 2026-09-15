import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { DEFAULT_CAPTION_STYLE } from "@caption-generator/captions";
import { prisma } from "@caption-generator/db";
import { env } from "@caption-generator/env/server";
import {
  createCaptionQueue,
  enqueueCaptionJob,
} from "@caption-generator/queue";
import type { CaptionStyle } from "@caption-generator/types";
import { cors } from "hono/cors";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { z } from "zod";
import { serializeProject } from "./project";
import { putObject } from "./storage";
import { startCaptionWorker } from "./worker";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const queue = createCaptionQueue(env.REDIS_URL);
const worker = startCaptionWorker();
const app = new Hono();

app.use(logger());
app.use(
  "/api/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
  }),
);

app.get("/health", (context) => context.json({ ok: true }));

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
  const project = await prisma.captionProject.create({
    data: {
      id,
      fileName: uploaded.name,
      contentType: uploaded.type || "application/octet-stream",
      mediaType,
      sourceKey,
      captionStyle: DEFAULT_CAPTION_STYLE,
    },
  });
  await enqueueCaptionJob(
    queue,
    { kind: "transcribe", projectId: id },
    { jobId: `transcribe-${id}` },
  );
  return context.json(await serializeProject(project), 201);
});

app.get("/api/projects/:id", async (context) => {
  const project = await prisma.captionProject.findUnique({
    where: { id: context.req.param("id") },
  });
  if (!project) return context.json({ error: "Project not found." }, 404);
  return context.json(await serializeProject(project));
});

const styleSchema = z.object({
  templateId: z.enum(["viral", "clean", "neon", "boxed", "karaoke"]),
  fontFamily: z.string().min(1).max(120),
  fontSize: z.number().min(28).max(140),
  fontWeight: z.number().min(300).max(950),
  textColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  activeColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  strokeColor: z.string().max(32),
  strokeWidth: z.number().min(0).max(16),
  backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  backgroundOpacity: z.number().min(0).max(1),
  borderRadius: z.number().min(0).max(80),
  maxWords: z.number().int().min(1).max(10),
  uppercase: z.boolean(),
  positionY: z.number().min(5).max(90),
});

app.patch("/api/projects/:id/style", async (context) => {
  const parsed = styleSchema.safeParse(await context.req.json());
  if (!parsed.success)
    return context.json(
      { error: "Invalid caption style.", details: parsed.error.flatten() },
      400,
    );
  const existing = await prisma.captionProject.findUnique({
    where: { id: context.req.param("id") },
  });
  if (!existing) return context.json({ error: "Project not found." }, 404);
  const project = await prisma.captionProject.update({
    where: { id: existing.id },
    data: { captionStyle: parsed.data satisfies CaptionStyle },
  });
  return context.json(await serializeProject(project));
});

app.post("/api/projects/:id/export", async (context) => {
  const id = context.req.param("id");
  const project = await prisma.captionProject.findUnique({ where: { id } });
  if (!project) return context.json({ error: "Project not found." }, 404);
  if (!project.transcript || !project.durationSeconds) {
    return context.json(
      { error: "Wait for transcription to finish before exporting." },
      409,
    );
  }
  const updated = await prisma.captionProject.update({
    where: { id },
    data: {
      status: "EXPORTING",
      renderProgress: 0,
      exportKey: null,
      error: null,
    },
  });
  await enqueueCaptionJob(
    queue,
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

const server = serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`Caption API running on http://localhost:${port}`);
});

const shutdown = async () => {
  server.close();
  await Promise.all([worker.close(), queue.close(), prisma.$disconnect()]);
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

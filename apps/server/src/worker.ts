import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { AI } from "@caption-generator/ai";
import { prisma } from "@caption-generator/db";
import { env } from "@caption-generator/env/server";
import { CAPTION_QUEUE_NAME, type CaptionJob } from "@caption-generator/queue";
import type { CaptionStyle, CaptionWord } from "@caption-generator/types";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { Worker } from "bullmq";
import ffmpegPath from "ffmpeg-static";
import { getObjectBuffer, putObject } from "./storage";

const execFileAsync = promisify(execFile);
const ai = new AI();
let bundlePromise: Promise<string> | null = null;

const getBundle = () => {
  if (!bundlePromise) {
    const serverDirectory = dirname(fileURLToPath(import.meta.url));
    const entryPoint =
      env.REMOTION_ENTRY_POINT ??
      join(
        serverDirectory,
        "../../../packages/captions/src/remotion-entry.tsx",
      );
    bundlePromise = bundle({ entryPoint, enableCaching: true });
  }
  return bundlePromise;
};

const extensionFromName = (name: string) => {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name);
  return match?.[1]?.toLowerCase() ?? "bin";
};

const normalizeWords = (
  raw: unknown,
  durationSeconds: number,
): CaptionWord[] => {
  const response = raw as {
    words?: Array<{
      word?: string;
      text?: string;
      start?: number;
      end?: number;
    }>;
    text?: string;
  };
  const words = response.words
    ?.map((word) => ({
      text: (word.word ?? word.text ?? "").trim(),
      start: Number(word.start ?? 0),
      end: Number(word.end ?? word.start ?? 0),
    }))
    .filter(
      (word) =>
        word.text.length > 0 &&
        Number.isFinite(word.start) &&
        Number.isFinite(word.end),
    );

  if (words?.length) return words;

  const fallback = response.text?.trim().split(/\s+/).filter(Boolean) ?? [];
  const step = durationSeconds / Math.max(1, fallback.length);
  return fallback.map((text, index) => ({
    text,
    start: index * step,
    end: (index + 1) * step,
  }));
};

const transcribeProject = async (projectId: string) => {
  const project = await prisma.captionProject.update({
    where: { id: projectId },
    data: { status: "PROCESSING", error: null },
  });
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "caption-transcribe-"),
  );

  try {
    if (!ffmpegPath)
      throw new Error(
        "ffmpeg-static did not provide a binary for this platform",
      );
    const inputPath = join(
      temporaryDirectory,
      `source.${extensionFromName(project.fileName)}`,
    );
    const audioPath = join(temporaryDirectory, "audio.mp3");
    await writeFile(inputPath, await getObjectBuffer(project.sourceKey));
    await execFileAsync(ffmpegPath, [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      audioPath,
    ]);

    const transcription = await ai.transcribe({ audioPath });
    const raw = transcription as unknown as {
      duration?: number;
      words?: unknown[];
      text?: string;
    };
    const lastEnd =
      raw.words?.reduce<number>((max, item) => {
        const end = Number((item as { end?: number }).end ?? 0);
        return Math.max(max, end);
      }, 0) ?? 0;
    const durationSeconds = Math.max(Number(raw.duration ?? 0), lastEnd, 0.1);
    const words = normalizeWords(raw, durationSeconds);
    const audioKey = `projects/${project.id}/audio.mp3`;
    const transcriptKey = `projects/${project.id}/verbose.json`;
    const transcript = {
      text: raw.text ?? "",
      duration: durationSeconds,
      words,
    };

    await Promise.all([
      putObject(audioKey, await readFile(audioPath), "audio/mpeg"),
      putObject(transcriptKey, JSON.stringify(transcript), "application/json"),
    ]);
    await prisma.captionProject.update({
      where: { id: project.id },
      data: {
        status: "READY",
        audioKey,
        transcriptKey,
        transcript,
        durationSeconds,
      },
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
};

const exportProject = async (projectId: string) => {
  const project = await prisma.captionProject.findUniqueOrThrow({
    where: { id: projectId },
  });
  const transcript = project.transcript as { words?: CaptionWord[] } | null;
  const words = transcript?.words ?? [];
  if (!project.durationSeconds || words.length === 0)
    throw new Error("Project has no completed transcript");

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "caption-render-"));
  const outputPath = join(temporaryDirectory, "captions.webm");
  try {
    await prisma.captionProject.update({
      where: { id: project.id },
      data: { renderProgress: 1 },
    });
    const serveUrl = await getBundle();
    const inputProps = {
      words,
      style: project.captionStyle as unknown as CaptionStyle,
      durationSeconds: project.durationSeconds,
      includeAudio: false,
    };
    const composition = await selectComposition({
      serveUrl,
      id: "CaptionOverlay",
      inputProps,
    });
    let lastReportedProgress = 1;
    let lastProgressWriteAt = 0;
    let progressWrites = Promise.resolve();
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      codec: "vp9",
      imageFormat: "png",
      pixelFormat: "yuva420p",
      muted: true,
      outputLocation: outputPath,
      concurrency: 2,
      logLevel: "warn",
      chromiumOptions: {
        enableMultiProcessOnLinux: true,
        ...(env.REMOTION_GL ? { gl: env.REMOTION_GL } : {}),
      },
      browserExecutable: env.REMOTION_BROWSER_EXECUTABLE,
      onProgress: ({ progress }) => {
        const percentage = Math.min(
          99,
          Math.max(1, Math.round(progress * 100)),
        );
        const now = Date.now();
        if (
          percentage <= lastReportedProgress ||
          (percentage < lastReportedProgress + 2 &&
            now - lastProgressWriteAt < 500)
        ) {
          return;
        }
        lastReportedProgress = percentage;
        lastProgressWriteAt = now;
        progressWrites = progressWrites.then(() =>
          prisma.captionProject
            .update({
              where: { id: project.id },
              data: { renderProgress: percentage },
            })
            .then(() => undefined),
        );
      },
    });
    await progressWrites;

    const exportKey = `projects/${project.id}/captions.webm`;
    await putObject(exportKey, await readFile(outputPath), "video/webm");
    await prisma.captionProject.update({
      where: { id: project.id },
      data: { status: "COMPLETE", renderProgress: 100, exportKey },
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
};

export const startCaptionWorker = () => {
  const worker = new Worker<CaptionJob>(
    CAPTION_QUEUE_NAME,
    async (job) => {
      if (job.data.kind === "transcribe")
        await transcribeProject(job.data.projectId);
      else await exportProject(job.data.projectId);
    },
    {
      connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
      concurrency: env.WORKER_CONCURRENCY,
    },
  );

  worker.on("failed", async (job, error) => {
    const projectId = job?.data.projectId;
    if (!projectId || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    await prisma.captionProject
      .update({
        where: { id: projectId },
        data: { status: "FAILED", error: error.message.slice(0, 1_000) },
      })
      .catch(() => undefined);
  });

  return worker;
};

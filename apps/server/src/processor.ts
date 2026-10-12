import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { AI } from "@caption-generator/ai";
import { normalizeCaptionStyle } from "@caption-generator/captions";
import { env } from "@caption-generator/env/server";
import type { CaptionJob, CaptionWord } from "@caption-generator/types";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import ffmpegPath from "ffmpeg-static";
import { transcriptWords } from "./project";
import type { ProjectStore } from "./project-store";
import { getObjectBuffer, putObject } from "./storage";

const execFileAsync = promisify(execFile);
const ai = new AI();
let bundlePromise: Promise<string> | null = null;

// A Windows verbatim path (\\?\C:\...) as plain C:\..., because webpack reads
// the "?" in it as the start of a query and then finds no file to open.
const plainPath = (path: string) =>
  path.replace(/^\\\\\?\\UNC\\/, "\\\\").replace(/^\\\\\?\\/, "");

const getBundle = () => {
  if (!bundlePromise) {
    const serverDirectory = dirname(fileURLToPath(import.meta.url));
    const entryPoint = env.REMOTION_ENTRY_POINT
      ? plainPath(env.REMOTION_ENTRY_POINT)
      : join(
          serverDirectory,
          "../../../packages/captions/src/remotion-entry.tsx",
        );
    // The packaged app points at a copy of the composition inside
    // node_modules. Webpack trusts everything there by package version, which
    // never changes for a workspace package, so its persistent cache would
    // keep rendering the composition of an older install after an update.
    const packaged = Boolean(env.REMOTION_ENTRY_POINT);
    if (packaged) {
      // Left behind by builds that still cached; nothing reads it any more.
      void rm(join(dirname(entryPoint), "../node_modules/.cache"), {
        recursive: true,
        force: true,
      }).catch(() => undefined);
    }
    bundlePromise = bundle({ entryPoint, enableCaching: !packaged }).catch(
      (error: unknown) => {
        // Let the next export try again instead of failing for good.
        bundlePromise = null;
        throw error;
      },
    );
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

const transcribeProject = async (store: ProjectStore, projectId: string) => {
  const project = await store.update(projectId, {
    status: "PROCESSING",
    error: null,
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
    await store.update(project.id, {
      status: "READY",
      audioKey,
      transcriptKey,
      transcript,
      durationSeconds,
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
};

const exportProject = async (store: ProjectStore, projectId: string) => {
  const project = await store.requireById(projectId);
  const words = transcriptWords(project.transcript, project.durationSeconds);
  if (!project.durationSeconds || words.length === 0)
    throw new Error("Project has no completed transcript");

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "caption-render-"));
  const outputPath = join(temporaryDirectory, "captions.webm");
  try {
    await store.update(project.id, { renderProgress: 1 });
    const serveUrl = await getBundle();
    const inputProps = {
      words,
      style: normalizeCaptionStyle(project.captionStyle),
      durationSeconds: project.durationSeconds,
      includeAudio: false,
    };
    const browserExecutable = env.REMOTION_BROWSER_EXECUTABLE
      ? plainPath(env.REMOTION_BROWSER_EXECUTABLE)
      : undefined;
    const composition = await selectComposition({
      serveUrl,
      id: "CaptionOverlay",
      inputProps,
      browserExecutable,
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
      browserExecutable,
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
          store
            .update(project.id, { renderProgress: percentage })
            .then(() => undefined),
        );
      },
    });
    await progressWrites;

    const exportKey = `projects/${project.id}/captions.webm`;
    await putObject(exportKey, await readFile(outputPath), "video/webm");
    await store.update(project.id, {
      status: "COMPLETE",
      renderProgress: 100,
      exportKey,
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
};

export const runCaptionJob = async (store: ProjectStore, job: CaptionJob) => {
  if (job.kind === "transcribe") await transcribeProject(store, job.projectId);
  else await exportProject(store, job.projectId);
};

"use client";

import {
  CaptionComposition,
  CAPTION_TEMPLATES,
  DEFAULT_CAPTION_STYLE,
} from "@caption-generator/captions";
import type {
  CaptionProject,
  CaptionStyle,
  CaptionTemplateId,
} from "@caption-generator/types";
import { Player } from "@remotion/player";
import {
  Captions,
  CircleAlert,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  Film,
  Gauge,
  Layers3,
  LoaderCircle,
  Music2,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Settings,
  ShieldCheck,
  Sparkles,
  Type,
  UploadCloud,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";
const DESKTOP_FIELDS = [
  {
    key: "DATABASE_URL",
    label: "PostgreSQL URL",
    placeholder: "postgresql://user:password@host:5432/postgres",
    secret: true,
  },
  {
    key: "GROQ_API_KEY",
    label: "Groq API key",
    placeholder: "gsk_...",
    secret: true,
  },
  {
    key: "REDIS_URL",
    label: "Redis URL",
    placeholder: "rediss://default:password@host:6379",
    secret: true,
  },
  {
    key: "AWS_ACCESS_KEY",
    label: "Storage access key",
    placeholder: "Access key",
    secret: true,
  },
  {
    key: "AWS_SECRET_KEY",
    label: "Storage secret key",
    placeholder: "Secret key",
    secret: true,
  },
  {
    key: "STORAGE_REGION",
    label: "Storage region",
    placeholder: "ap-southeast-1",
    secret: false,
  },
  {
    key: "STORAGE_BUCKET",
    label: "Storage bucket",
    placeholder: "captionlab-files",
    secret: false,
  },
] as const;

type DesktopFieldKey = (typeof DESKTOP_FIELDS)[number]["key"];
type DesktopSettingsDraft = Partial<Record<DesktopFieldKey, string>>;
type DesktopServiceState = "needs-setup" | "starting" | "ready" | "error";

interface DesktopSnapshot {
  configured: boolean;
  state: DesktopServiceState;
  error: string | null;
  savedFields: Record<DesktopFieldKey, boolean>;
  values: {
    STORAGE_REGION: string;
    STORAGE_BUCKET: string;
  };
}
const TEMPLATE_META: Array<{
  id: CaptionTemplateId;
  name: string;
  note: string;
}> = [
  { id: "viral", name: "Viral pop", note: "Bold · Punchy" },
  { id: "clean", name: "Clean slate", note: "Minimal · Clear" },
  { id: "neon", name: "Night neon", note: "Glow · Energy" },
  { id: "boxed", name: "Editorial", note: "Boxed · Modern" },
  { id: "karaoke", name: "Karaoke", note: "Soft · Musical" },
];

const formatTime = (seconds: number) => {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${Math.floor(safe % 60)
    .toString()
    .padStart(2, "0")}`;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body;
}

export function CaptionStudio() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<CaptionProject | null>(null);
  const [style, setStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE);
  const [localMediaUrl, setLocalMediaUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [desktopStatus, setDesktopStatus] = useState<DesktopSnapshot | null>(
    null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  const projectId = project?.id;
  const projectStatus = project?.status;
  const shouldPoll =
    projectStatus === "UPLOADED" ||
    projectStatus === "PROCESSING" ||
    projectStatus === "EXPORTING";

  useEffect(() => {
    if (!projectId || !shouldPoll) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`${SERVER_URL}/api/projects/${projectId}`);
        const next = await parseResponse<CaptionProject>(response);
        if (!cancelled) {
          setProject(next);
          setStyle(next.style);
          if (next.status === "FAILED")
            setError(next.error ?? "Processing failed");
        }
      } catch (pollError) {
        if (!cancelled)
          setError(
            pollError instanceof Error
              ? pollError.message
              : "Could not reach the server",
          );
      }
    }, 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectId, shouldPoll]);

  useEffect(() => {
    const desktop = window.captionDesktop;
    if (!desktop) return;
    let cancelled = false;
    void desktop
      .getSettings()
      .then((snapshot) => {
        if (cancelled) return;
        setDesktopStatus(snapshot);
        if (!snapshot.configured) setSettingsOpen(true);
      })
      .catch((desktopError) => {
        if (!cancelled)
          setError(
            desktopError instanceof Error
              ? desktopError.message
              : "Could not load desktop settings",
          );
      });
    const unsubscribe = desktop.onStatus((snapshot) => {
      if (!cancelled) setDesktopStatus(snapshot);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(
    () => () => {
      if (localMediaUrl) URL.revokeObjectURL(localMediaUrl);
    },
    [localMediaUrl],
  );

  const upload = useCallback(async (file: File) => {
    if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
      setError("Choose an audio or video file.");
      return;
    }
    setError(null);
    setUploading(true);
    setProject(null);
    setStyle(DEFAULT_CAPTION_STYLE);
    setLocalMediaUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
    try {
      const form = new FormData();
      form.set("file", file);
      const created = await parseResponse<CaptionProject>(
        await fetch(`${SERVER_URL}/api/projects`, {
          method: "POST",
          body: form,
        }),
      );
      setProject(created);
      setStyle(created.style);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed",
      );
    } finally {
      setUploading(false);
    }
  }, []);

  const saveStyle = useCallback(
    async (nextStyle: CaptionStyle) => {
      setStyle(nextStyle);
      if (!projectId) return;
      try {
        const response = await fetch(
          `${SERVER_URL}/api/projects/${projectId}/style`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(nextStyle),
          },
        );
        setProject(await parseResponse<CaptionProject>(response));
      } catch (saveError) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Could not save style",
        );
      }
    },
    [projectId],
  );

  const exportOverlay = async () => {
    if (!projectId) return;
    setError(null);
    try {
      await saveStyle(style);
      const response = await fetch(
        `${SERVER_URL}/api/projects/${projectId}/export`,
        { method: "POST" },
      );
      setProject(await parseResponse<CaptionProject>(response));
    } catch (exportError) {
      setError(
        exportError instanceof Error ? exportError.message : "Export failed",
      );
    }
  };

  const downloadOverlay = async () => {
    if (!project?.exportUrl) return;
    try {
      await window.captionDesktop?.download(
        project.exportUrl,
        `${project.fileName.replace(/\.[^.]+$/, "") || "captions"}-captions.webm`,
      );
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Download failed",
      );
    }
  };

  const playerProps = useMemo(
    () => ({
      words: project?.words ?? [],
      style,
      durationSeconds: project?.durationSeconds ?? 1,
      audioSrc: localMediaUrl ?? project?.sourceUrl ?? undefined,
      includeAudio: true,
    }),
    [
      localMediaUrl,
      project?.durationSeconds,
      project?.sourceUrl,
      project?.words,
      style,
    ],
  );

  if (!project && !uploading) {
    return (
      <main className="min-h-screen bg-[#08080a] text-white selection:bg-lime-300 selection:text-black">
        <Header
          onNew={() => inputRef.current?.click()}
          onSettings={desktopStatus ? () => setSettingsOpen(true) : undefined}
          desktopState={desktopStatus?.state}
        />
        <section className="mx-auto grid min-h-[calc(100vh-72px)] max-w-7xl items-center gap-14 px-6 py-14 lg:grid-cols-[1fr_0.9fr] lg:px-10">
          <div>
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/8 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-lime-300">
              <Sparkles size={14} /> Word-perfect overlays
            </div>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-7xl">
              Captions that move
              <br />
              at the speed of <span className="text-lime-300">speech.</span>
            </h1>
            <p className="mt-7 max-w-xl text-base leading-7 text-zinc-400 sm:text-lg">
              Drop in audio or video. CaptionLab finds every word, times it
              precisely, and exports a transparent overlay ready for your
              favorite editor.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3 text-sm text-zinc-500">
              <span className="rounded-full border border-white/10 px-3 py-1.5">
                Groq Whisper
              </span>
              <span className="rounded-full border border-white/10 px-3 py-1.5">
                Word-level sync
              </span>
              <span className="rounded-full border border-white/10 px-3 py-1.5">
                Alpha WebM
              </span>
            </div>
          </div>
          <label
            className={`group relative flex min-h-[430px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[32px] border bg-[#111114] p-9 text-center transition ${isDragging ? "border-lime-300 bg-lime-300/5" : "border-white/10 hover:border-white/25"}`}
            onDragEnter={() => setIsDragging(true)}
            onDragLeave={() => setIsDragging(false)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) void upload(file);
            }}
          >
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="audio/*,video/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_center,rgba(185,255,55,.18),transparent_48%)]" />
            <div className="relative grid size-24 place-items-center rounded-3xl border border-lime-300/20 bg-lime-300/10 text-lime-300 shadow-[0_0_80px_rgba(180,255,50,.12)] transition group-hover:scale-105">
              <UploadCloud size={38} strokeWidth={1.6} />
            </div>
            <h2 className="relative mt-8 text-2xl font-semibold tracking-tight">
              Drop your story here
            </h2>
            <p className="relative mt-2 text-sm text-zinc-500">
              Audio or video · MP3, WAV, MP4, MOV · up to 100 MB
            </p>
            <span className="relative mt-7 rounded-full bg-lime-300 px-5 py-2.5 text-sm font-bold text-black">
              Choose a file
            </span>
            {error ? (
              <p className="relative mt-5 text-sm text-red-400">{error}</p>
            ) : null}
          </label>
        </section>
        {settingsOpen && desktopStatus ? (
          <DesktopSettingsModal
            snapshot={desktopStatus}
            onClose={() => setSettingsOpen(false)}
            onSaved={(snapshot) => {
              setDesktopStatus(snapshot);
              setSettingsOpen(false);
            }}
          />
        ) : null}
      </main>
    );
  }

  return (
    <main className="flex h-screen min-h-[720px] flex-col overflow-hidden bg-[#09090b] text-zinc-100">
      <Header
        onNew={() => inputRef.current?.click()}
        onSettings={desktopStatus ? () => setSettingsOpen(true) : undefined}
        desktopState={desktopStatus?.state}
      />
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept="audio/*,video/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <div className="flex min-h-0 flex-1">
        <ToolRail />
        <section className="flex min-w-0 flex-1 flex-col bg-[#0d0d10]">
          <div className="flex h-12 items-center justify-between border-b border-white/[0.07] px-5 text-xs text-zinc-500">
            <div className="flex items-center gap-2">
              <Film size={14} /> {project?.fileName ?? "Uploading media..."}
            </div>
            <div className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-lime-300" /> Autosaved
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
            <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(#303038_1px,transparent_1px)] [background-size:20px_20px]" />
            <div className="relative aspect-[9/16] h-[min(64vh,680px)] overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(45deg,#242429_25%,transparent_25%),linear-gradient(-45deg,#242429_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#242429_75%),linear-gradient(-45deg,transparent_75%,#242429_75%)] bg-[length:22px_22px] bg-[position:0_0,0_11px,11px_-11px,-11px_0px] shadow-2xl shadow-black/50">
              {project?.durationSeconds && project.words.length > 0 ? (
                <Player
                  component={CaptionComposition}
                  inputProps={playerProps}
                  durationInFrames={Math.max(
                    1,
                    Math.ceil(project.durationSeconds * project.fps),
                  )}
                  compositionWidth={project.width}
                  compositionHeight={project.height}
                  fps={project.fps}
                  controls
                  showVolumeControls
                  style={{ width: "100%", height: "100%" }}
                />
              ) : (
                <ProcessingState
                  status={
                    uploading ? "UPLOADED" : (project?.status ?? "UPLOADED")
                  }
                />
              )}
              {project?.status === "EXPORTING" ? (
                <RenderProgressOverlay progress={project.renderProgress} />
              ) : null}
            </div>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-zinc-400 backdrop-blur">
              Transparent canvas
            </div>
          </div>
          <Timeline project={project} />
        </section>
        <aside className="hidden w-[310px] shrink-0 overflow-y-auto border-l border-white/[0.07] bg-[#111114] xl:block">
          <div className="border-b border-white/[0.07] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Caption style</h2>
              <RotateCcw size={14} className="text-zinc-600" />
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Pick a look, then make it yours.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4">
            {TEMPLATE_META.map((template) => {
              const templateStyle = CAPTION_TEMPLATES[template.id];
              const selected = style.templateId === template.id;
              return (
                <button
                  key={template.id}
                  onClick={() => void saveStyle({ ...templateStyle })}
                  className={`relative overflow-hidden rounded-xl border p-2.5 text-left transition ${selected ? "border-lime-300 bg-lime-300/5" : "border-white/[0.08] bg-white/[0.025] hover:border-white/20"}`}
                >
                  {selected ? (
                    <span className="absolute right-2 top-2 grid size-4 place-items-center rounded-full bg-lime-300 text-black">
                      <Check size={10} strokeWidth={3} />
                    </span>
                  ) : null}
                  <div
                    className="grid h-16 place-items-center rounded-lg bg-[#1a1a1e] text-center"
                    style={{ fontFamily: templateStyle.fontFamily }}
                  >
                    <span
                      className="text-base font-black"
                      style={{
                        color: templateStyle.activeColor,
                        WebkitTextStroke: `${Math.min(2, templateStyle.strokeWidth)}px ${templateStyle.strokeColor}`,
                      }}
                    >
                      SAY IT
                    </span>
                  </div>
                  <p className="mt-2.5 text-xs font-semibold text-zinc-200">
                    {template.name}
                  </p>
                  <p className="mt-0.5 text-[10px] text-zinc-600">
                    {template.note}
                  </p>
                </button>
              );
            })}
          </div>
          <StyleControls
            style={style}
            onChange={(next) => void saveStyle(next)}
          />
          <div className="sticky bottom-0 border-t border-white/[0.07] bg-[#111114]/95 p-4 backdrop-blur">
            {project?.status === "COMPLETE" && project.exportUrl ? (
              desktopStatus ? (
                <button
                  onClick={() => void downloadOverlay()}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-lime-300 text-sm font-bold text-black hover:bg-lime-200"
                >
                  <Download size={16} /> Save WebM
                </button>
              ) : (
                <a
                  href={project.exportUrl}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-lime-300 text-sm font-bold text-black hover:bg-lime-200"
                >
                  <Download size={16} /> Download WebM
                </a>
              )
            ) : (
              <button
                disabled={
                  !project ||
                  ["PROCESSING", "UPLOADED", "EXPORTING"].includes(
                    project.status,
                  )
                }
                onClick={() => void exportOverlay()}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-lime-300 text-sm font-bold text-black transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {project?.status === "EXPORTING" ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : (
                  <Download size={16} />
                )}
                {project?.status === "EXPORTING"
                  ? `Rendering overlay · ${project.renderProgress}%`
                  : "Export transparent WebM"}
              </button>
            )}
            {project?.status === "EXPORTING" ? (
              <ProgressBar progress={project.renderProgress} />
            ) : null}
            <p className="mt-2 text-center text-[10px] text-zinc-600">
              VP9 alpha · 1080 × 1920 · no background
            </p>
          </div>
        </aside>
      </div>
      {error ? (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-red-400/20 bg-red-950/90 px-4 py-3 text-sm text-red-200 shadow-xl">
          {error}
        </div>
      ) : null}
      {settingsOpen && desktopStatus ? (
        <DesktopSettingsModal
          snapshot={desktopStatus}
          onClose={() => setSettingsOpen(false)}
          onSaved={(snapshot) => {
            setDesktopStatus(snapshot);
            setSettingsOpen(false);
          }}
        />
      ) : null}
    </main>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  const safeProgress = Math.min(100, Math.max(0, progress));
  return (
    <div
      className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
      role="progressbar"
      aria-label="Render progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safeProgress}
    >
      <div
        className="h-full rounded-full bg-lime-300 transition-[width] duration-500 ease-out"
        style={{ width: `${safeProgress}%` }}
      />
    </div>
  );
}

function RenderProgressOverlay({ progress }: { progress: number }) {
  const safeProgress = Math.min(99, Math.max(1, progress));
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 px-8 backdrop-blur-[2px]">
      <div className="w-full max-w-[260px] rounded-2xl border border-white/10 bg-[#111114]/95 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
            <LoaderCircle className="animate-spin text-lime-300" size={15} />
            Rendering overlay
          </span>
          <span className="font-mono text-sm font-bold text-lime-300">
            {safeProgress}%
          </span>
        </div>
        <ProgressBar progress={safeProgress} />
        <p className="mt-3 text-[10px] leading-4 text-zinc-500">
          Rendering frames and encoding transparent VP9
        </p>
      </div>
    </div>
  );
}

function Header({
  onNew,
  onSettings,
  desktopState,
}: {
  onNew: () => void;
  onSettings?: () => void;
  desktopState?: DesktopServiceState;
}) {
  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-white/[0.07] bg-[#0b0b0d] px-5 sm:px-7">
      <div className="flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-xl bg-lime-300 text-black">
          <Captions size={21} strokeWidth={2.4} />
        </div>
        <div>
          <p className="text-sm font-bold tracking-tight">CaptionLab</p>
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-600">
            Motion typography
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {onSettings ? (
          <button
            onClick={onSettings}
            className="flex h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-semibold text-zinc-300 hover:border-white/20 hover:bg-white/5"
            aria-label="Desktop settings"
          >
            <span
              className={`size-1.5 rounded-full ${
                desktopState === "ready"
                  ? "bg-lime-300"
                  : desktopState === "error"
                    ? "bg-red-400"
                    : "bg-amber-300"
              }`}
            />
            <Settings size={15} /> Settings
          </button>
        ) : null}
        <button
          className="hidden size-9 place-items-center rounded-lg border border-white/10 text-zinc-500 hover:text-white sm:grid"
          aria-label="Help"
        >
          <CircleHelp size={17} />
        </button>
        <button
          onClick={onNew}
          className="flex h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-semibold text-zinc-300 hover:border-white/20 hover:bg-white/5"
        >
          <Plus size={15} /> New project
        </button>
      </div>
    </header>
  );
}

function DesktopSettingsModal({
  snapshot,
  onClose,
  onSaved,
}: {
  snapshot: DesktopSnapshot;
  onClose: () => void;
  onSaved: (snapshot: DesktopSnapshot) => void;
}) {
  const [draft, setDraft] = useState<DesktopSettingsDraft>({
    STORAGE_REGION: snapshot.values.STORAGE_REGION,
    STORAGE_BUCKET: snapshot.values.STORAGE_BUCKET,
  });
  const [saving, setSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!window.captionDesktop) return;
    setSaving(true);
    setSettingsError(null);
    try {
      onSaved(await window.captionDesktop.saveSettings(draft));
    } catch (saveError) {
      setSettingsError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save settings",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <form
        onSubmit={(event) => void save(event)}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-[#111114] shadow-2xl shadow-black"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-white/[0.07] bg-[#111114]/95 px-6 py-5 backdrop-blur">
          <div>
            <div className="flex items-center gap-2 text-lime-300">
              <ShieldCheck size={18} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                Desktop runtime
              </span>
            </div>
            <h2 className="mt-2 text-xl font-semibold">Connections & keys</h2>
            <p className="mt-1 max-w-lg text-xs leading-5 text-zinc-500">
              Credentials are encrypted with your operating system account and
              never exposed through a public server.
            </p>
          </div>
          {snapshot.configured ? (
            <button
              type="button"
              onClick={onClose}
              className="grid size-9 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white"
              aria-label="Close settings"
            >
              <X size={18} />
            </button>
          ) : null}
        </div>

        <div className="grid gap-4 p-6 sm:grid-cols-2">
          {DESKTOP_FIELDS.map((field) => {
            const saved = snapshot.savedFields[field.key];
            return (
              <label
                key={field.key}
                className={
                  field.key === "DATABASE_URL" || field.key === "REDIS_URL"
                    ? "sm:col-span-2"
                    : ""
                }
              >
                <span className="mb-2 flex items-center justify-between text-xs font-medium text-zinc-300">
                  {field.label}
                  {saved ? (
                    <span className="flex items-center gap-1 text-[10px] font-normal text-lime-300/70">
                      <Check size={10} /> Saved
                    </span>
                  ) : null}
                </span>
                <input
                  type={field.secret ? "password" : "text"}
                  autoComplete="off"
                  value={draft[field.key] ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                  placeholder={
                    saved && field.secret
                      ? "Leave blank to keep saved value"
                      : field.placeholder
                  }
                  required={!saved}
                  className="h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-700 focus:border-lime-300/50 focus:ring-2 focus:ring-lime-300/10"
                />
              </label>
            );
          })}
        </div>

        <div className="mx-6 rounded-xl border border-amber-300/15 bg-amber-300/5 p-3 text-xs leading-5 text-amber-100/70">
          PostgreSQL, Redis, S3-compatible storage, and Groq still need network
          access. The UI, API, worker, FFmpeg, and video renderer run locally.
        </div>

        {settingsError || snapshot.error ? (
          <div className="mx-6 mt-4 flex items-start gap-2 rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-xs leading-5 text-red-300">
            <CircleAlert className="mt-0.5 shrink-0" size={14} />
            {settingsError ?? snapshot.error}
          </div>
        ) : null}

        <div className="sticky bottom-0 mt-6 flex items-center justify-between border-t border-white/[0.07] bg-[#111114]/95 px-6 py-4 backdrop-blur">
          <p className="text-[10px] text-zinc-600">
            Saving restarts the local API and worker.
          </p>
          <button
            type="submit"
            disabled={saving}
            className="flex h-10 items-center gap-2 rounded-xl bg-lime-300 px-5 text-xs font-bold text-black hover:bg-lime-200 disabled:cursor-wait disabled:bg-zinc-700 disabled:text-zinc-400"
          >
            {saving ? (
              <LoaderCircle className="animate-spin" size={15} />
            ) : (
              <ShieldCheck size={15} />
            )}
            {saving ? "Testing connections…" : "Save and start"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ToolRail() {
  const tools = [
    { icon: Scissors, label: "Edit" },
    { icon: Type, label: "Text" },
    { icon: Layers3, label: "Layers" },
    { icon: Music2, label: "Audio" },
  ];
  return (
    <nav className="hidden w-[76px] shrink-0 border-r border-white/[0.07] bg-[#111114] py-4 md:block">
      {tools.map(({ icon: Icon, label }, index) => (
        <button
          key={label}
          className={`mx-auto mb-2 flex w-14 flex-col items-center gap-1.5 rounded-xl py-3 text-[10px] transition ${index === 1 ? "bg-lime-300/10 text-lime-300" : "text-zinc-600 hover:bg-white/5 hover:text-zinc-300"}`}
        >
          <Icon size={18} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function ProcessingState({ status }: { status: CaptionProject["status"] }) {
  const exporting = status === "EXPORTING";
  return (
    <div className="flex h-full flex-col items-center justify-center bg-[#121216] px-8 text-center">
      <div className="relative grid size-20 place-items-center rounded-full border border-lime-300/20 bg-lime-300/5 text-lime-300">
        <span className="absolute inset-0 animate-ping rounded-full border border-lime-300/20" />
        <WandSparkles size={28} />
      </div>
      <h3 className="mt-6 text-lg font-semibold">
        {exporting ? "Rendering every frame" : "Listening for every word"}
      </h3>
      <p className="mt-2 max-w-xs text-sm leading-6 text-zinc-500">
        {exporting
          ? "Building your transparent VP9 overlay. Longer clips need a little more time."
          : "Extracting clean audio and generating word-level timestamps with Groq Whisper."}
      </p>
      <div className="mt-7 h-1.5 w-44 overflow-hidden rounded-full bg-white/5">
        <div className="h-full w-2/5 animate-[loading_1.4s_ease-in-out_infinite] rounded-full bg-lime-300" />
      </div>
    </div>
  );
}

function Timeline({ project }: { project: CaptionProject | null }) {
  const duration = project?.durationSeconds ?? 0;
  return (
    <div className="h-[166px] shrink-0 border-t border-white/[0.07] bg-[#111114]">
      <div className="flex h-10 items-center justify-between border-b border-white/[0.06] px-4">
        <div className="flex items-center gap-2">
          <button
            className="grid size-6 place-items-center rounded-full bg-zinc-100 text-black"
            aria-label="Play timeline"
          >
            <Play size={11} fill="currentColor" />
          </button>
          <span className="font-mono text-[11px] text-zinc-500">
            0:00 / {formatTime(duration)}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-zinc-600">
          <Gauge size={13} /> 30 fps
        </div>
      </div>
      <div className="relative h-[126px] overflow-hidden px-4 pt-7">
        <div className="absolute left-4 right-4 top-3 flex justify-between font-mono text-[9px] text-zinc-700">
          <span>0:00</span>
          <span>{formatTime(duration / 2)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        <div className="flex h-16 min-w-full items-center gap-px overflow-hidden rounded-lg bg-[#17171b] px-2">
          {project?.words.length ? (
            project.words.slice(0, 80).map((word, index) => (
              <div
                key={`${word.start}-${index}`}
                className="group relative h-9 min-w-4 flex-1 rounded-sm bg-lime-300/15 hover:bg-lime-300/30"
              >
                <span className="absolute -top-5 left-0 hidden whitespace-nowrap text-[9px] text-zinc-400 group-hover:block">
                  {word.text}
                </span>
                <span
                  className="absolute bottom-0 left-1/2 w-px -translate-x-1/2 rounded-full bg-lime-300/60"
                  style={{ height: `${25 + ((index * 37) % 70)}%` }}
                />
              </div>
            ))
          ) : (
            <div className="flex w-full items-center justify-center text-xs text-zinc-700">
              Transcript appears here
            </div>
          )}
        </div>
        <div className="absolute bottom-0 left-[18%] top-0 w-px bg-lime-300/70">
          <span className="absolute -left-1 top-0 size-2 rotate-45 bg-lime-300" />
        </div>
      </div>
    </div>
  );
}

function StyleControls({
  style,
  onChange,
}: {
  style: CaptionStyle;
  onChange: (style: CaptionStyle) => void;
}) {
  return (
    <div className="border-t border-white/[0.07] p-5">
      <div className="mb-5 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Fine tune
        </h3>
        <ChevronDown size={14} className="text-zinc-600" />
      </div>
      <label className="mb-5 block">
        <span className="mb-2 flex justify-between text-xs text-zinc-400">
          <span>Size</span>
          <span className="font-mono text-zinc-600">{style.fontSize}px</span>
        </span>
        <input
          className="w-full accent-lime-300"
          type="range"
          min="36"
          max="110"
          value={style.fontSize}
          onChange={(event) =>
            onChange({ ...style, fontSize: Number(event.target.value) })
          }
        />
      </label>
      <label className="mb-5 block">
        <span className="mb-2 flex justify-between text-xs text-zinc-400">
          <span>Vertical position</span>
          <span className="font-mono text-zinc-600">{style.positionY}%</span>
        </span>
        <input
          className="w-full accent-lime-300"
          type="range"
          min="20"
          max="88"
          value={style.positionY}
          onChange={(event) =>
            onChange({ ...style, positionY: Number(event.target.value) })
          }
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <ColorField
          label="Text color"
          value={style.textColor}
          onChange={(value) => onChange({ ...style, textColor: value })}
        />
        <ColorField
          label="Highlight"
          value={style.activeColor}
          onChange={(value) => onChange({ ...style, activeColor: value })}
        />
      </div>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs text-zinc-500">
      {label}
      <div className="mt-2 flex h-9 items-center gap-2 rounded-lg border border-white/10 px-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="size-5 border-0 bg-transparent"
        />
        <span className="font-mono text-[10px]">{value}</span>
      </div>
    </label>
  );
}

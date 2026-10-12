"use client";

import type { CaptionProject } from "@caption-generator/types";
import {
  ArrowRight,
  Captions,
  Check,
  CircleAlert,
  CircleHelp,
  Film,
  Gauge,
  LoaderCircle,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { StudioEditor } from "@/components/studio/editor";
import { StudioProvider } from "@/components/studio/studio-context";
import { createProject, fetchProject } from "@/lib/api";
import {
  loadDesktopBridge,
  type DesktopBridge,
  type DesktopServiceState,
  type DesktopSettingsDraft,
  type DesktopSnapshot,
} from "@/lib/desktop";

// The open project is named in the address so a reload comes back to it, and
// the last one is remembered so the desktop app can offer it after a restart.
const PROJECT_PARAM = "project";
const RECENT_PROJECT_KEY = "captionlab:recent-project";

type RecentProject = { id: string; fileName: string };

const readRecentProject = (): RecentProject | null => {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(RECENT_PROJECT_KEY) ?? "null",
    ) as Partial<RecentProject> | null;
    return typeof stored?.id === "string" && typeof stored.fileName === "string"
      ? { id: stored.id, fileName: stored.fileName }
      : null;
  } catch {
    return null;
  }
};

const forgetProject = () => {
  try {
    window.localStorage.removeItem(RECENT_PROJECT_KEY);
  } catch {
    // Storage is unavailable; there is nothing to forget.
  }
  const url = new URL(window.location.href);
  url.searchParams.delete(PROJECT_PARAM);
  window.history.replaceState(null, "", url);
};

export function CaptionStudio() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<CaptionProject | null>(null);
  const [opening, setOpening] = useState(false);
  const [recent, setRecent] = useState<RecentProject | null>(null);
  const [localMediaUrl, setLocalMediaUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [desktopStatus, setDesktopStatus] = useState<DesktopSnapshot | null>(
    null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const desktopRef = useRef<DesktopBridge | null>(null);

  const projectId = project?.id;
  const projectStatus = project?.status;
  const shouldPoll =
    projectStatus === "UPLOADED" ||
    projectStatus === "PROCESSING" ||
    projectStatus === "EXPORTING";

  // Keeps the record of the open project in step with the API. The editor
  // owns the style and words; this only carries status, progress and links.
  const adoptProject = useCallback(
    (next: CaptionProject) =>
      setProject((current) => (current?.id === next.id ? next : current)),
    [],
  );

  useEffect(() => {
    if (!projectId || !shouldPoll) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const next = await fetchProject(projectId);
        if (cancelled) return;
        adoptProject(next);
        // A failed transcription is explained on the canvas itself.
        if (next.status === "FAILED" && next.words.length > 0)
          setError(next.error ?? "Export failed");
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
  }, [adoptProject, projectId, shouldPoll]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    void loadDesktopBridge()
      .then(async (desktop) => {
        if (!desktop || cancelled) return;
        desktopRef.current = desktop;
        unsubscribe = desktop.onStatus((snapshot) => {
          if (!cancelled) setDesktopStatus(snapshot);
        });
        const snapshot = await desktop.getSettings();
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

  const openProject = useCallback(async (id: string) => {
    setError(null);
    setOpening(true);
    try {
      setProject(await fetchProject(id));
    } catch (openError) {
      // A project that is gone should not be offered again.
      const missing =
        openError instanceof Error && /not found/i.test(openError.message);
      if (missing) {
        forgetProject();
        setRecent(null);
      }
      setError(
        missing
          ? "That project is no longer available."
          : openError instanceof Error
            ? openError.message
            : "Could not open the project",
      );
    } finally {
      setOpening(false);
    }
  }, []);

  // A reload returns to the project named in the address.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get(PROJECT_PARAM);
    setRecent(readRecentProject());
    if (id) void openProject(id);
  }, [openProject]);

  const fileName = project?.fileName;
  useEffect(() => {
    if (!projectId || !fileName) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get(PROJECT_PARAM) !== projectId) {
      url.searchParams.set(PROJECT_PARAM, projectId);
      window.history.replaceState(null, "", url);
    }
    try {
      window.localStorage.setItem(
        RECENT_PROJECT_KEY,
        JSON.stringify({ id: projectId, fileName }),
      );
    } catch {
      // Without storage the project is simply not offered after a restart.
    }
  }, [fileName, projectId]);

  const upload = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
        setError("Choose an audio or video file.");
        return;
      }
      if (desktopStatus && desktopStatus.state !== "ready") {
        setError(
          desktopStatus.error ??
            (desktopStatus.configured
              ? "The local API is still starting. Try again in a moment."
              : "Enter a Groq API key in Settings to start the local API."),
        );
        if (!desktopStatus.configured) setSettingsOpen(true);
        return;
      }
      setError(null);
      setUploading(true);
      setProject(null);
      setLocalMediaUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(file);
      });
      try {
        setProject(await createProject(file));
      } catch (uploadError) {
        setError(
          uploadError instanceof Error ? uploadError.message : "Upload failed",
        );
      } finally {
        setUploading(false);
      }
    },
    [desktopStatus],
  );

  const downloadOverlay = async () => {
    if (!project?.exportUrl) return;
    try {
      await desktopRef.current?.download(
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

  const settingsModal =
    settingsOpen && desktopStatus ? (
      <DesktopSettingsModal
        snapshot={desktopStatus}
        onClose={() => setSettingsOpen(false)}
        onSave={(draft) => {
          const desktop = desktopRef.current;
          if (!desktop) throw new Error("Desktop bridge is unavailable.");
          return desktop.saveSettings(draft);
        }}
        onSaved={(snapshot) => {
          setDesktopStatus(snapshot);
          if (snapshot.state !== "error") setSettingsOpen(false);
        }}
      />
    ) : null;

  const fileInput = (
    <input
      ref={inputRef}
      className="sr-only"
      type="file"
      accept="audio/*,video/*"
      onChange={(event) => {
        const file = event.target.files?.[0];
        // Clearing the value lets the same file be picked again later.
        event.target.value = "";
        if (file) void upload(file);
      }}
    />
  );

  const resume = () => {
    if (!recent) return;
    if (desktopStatus && desktopStatus.state !== "ready") {
      setError(
        desktopStatus.error ??
          (desktopStatus.configured
            ? "The local API is still starting. Try again in a moment."
            : "Enter a Groq API key in Settings to start the local API."),
      );
      if (!desktopStatus.configured) setSettingsOpen(true);
      return;
    }
    void openProject(recent.id);
  };

  if (!project && !uploading && !opening) {
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
            {recent ? (
              <button
                type="button"
                onClick={resume}
                className="mt-9 flex max-w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/3 px-4 py-3 text-left transition hover:border-lime-300/40 hover:bg-lime-300/5"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-300">
                  <Film size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs text-zinc-500">
                    Continue where you left off
                  </span>
                  <span className="block truncate text-sm font-semibold text-zinc-100">
                    {recent.fileName}
                  </span>
                </span>
                <ArrowRight size={16} className="shrink-0 text-zinc-500" />
              </button>
            ) : null}
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
            {fileInput}
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
        {settingsModal}
      </main>
    );
  }

  return (
    <main className="relative flex h-screen min-h-[620px] flex-col overflow-hidden bg-[#09090b] text-zinc-100">
      <Header
        onNew={() => inputRef.current?.click()}
        onSettings={desktopStatus ? () => setSettingsOpen(true) : undefined}
        desktopState={desktopStatus?.state}
      />
      {fileInput}
      {project ? (
        <StudioProvider
          key={project.id}
          project={project}
          mediaSrc={localMediaUrl ?? project.sourceUrl}
          onProjectChange={adoptProject}
          onError={setError}
          saveExport={desktopStatus ? downloadOverlay : null}
        >
          <StudioEditor />
        </StudioProvider>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-[#0d0d10] text-sm text-zinc-400">
          <LoaderCircle className="animate-spin text-lime-300" size={26} />
          {uploading ? "Uploading your media…" : "Opening your project…"}
        </div>
      )}
      {error ? (
        <div
          role="alert"
          className="fixed bottom-5 left-1/2 z-50 flex max-w-[min(90vw,640px)] -translate-x-1/2 items-start gap-3 rounded-xl border border-red-400/20 bg-red-950/90 px-4 py-3 text-sm text-red-200 shadow-xl"
        >
          <span className="min-w-0 break-words">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss"
            className="shrink-0 rounded text-red-300 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}
      {settingsModal}
    </main>
  );
}

const SHORTCUTS: ReadonlyArray<readonly [keys: string, action: string]> = [
  ["Space", "Play or pause"],
  ["← →", "Step one frame; with Shift, one second"],
  ["Ctrl+Z", "Undo; Ctrl+Shift+Z redoes"],
  ["Double-click", "Retype a word in the timeline"],
  ["Drag", "The timeline's top edge resizes it"],
  ["Ctrl+wheel", "Zoom the timeline"],
  ["Layers tab", "Drag the captions on the canvas"],
];

function HelpMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Shortcuts and tips"
        aria-expanded={open}
        className="grid size-9 place-items-center rounded-lg border border-white/10 text-zinc-500 hover:text-white"
      >
        <CircleHelp size={17} />
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-white/10 bg-[#141418] p-4 shadow-2xl shadow-black">
          <p className="text-xs font-semibold text-zinc-200">
            Shortcuts and tips
          </p>
          <dl className="mt-3 space-y-2.5">
            {SHORTCUTS.map(([keys, action]) => (
              <div
                key={keys}
                className="flex items-baseline justify-between gap-4 text-xs"
              >
                <dt className="shrink-0 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                  {keys}
                </dt>
                <dd className="text-right leading-4 text-zinc-500">{action}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
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
        <HelpMenu />
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
  onSave,
  onSaved,
}: {
  snapshot: DesktopSnapshot;
  onClose: () => void;
  onSave: (draft: DesktopSettingsDraft) => Promise<DesktopSnapshot>;
  onSaved: (snapshot: DesktopSnapshot) => void;
}) {
  const [draft, setDraft] = useState<DesktopSettingsDraft>({
    GPU_FRAME_ACCELERATION: snapshot.values.GPU_FRAME_ACCELERATION,
  });
  const [saving, setSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const groqSaved = snapshot.savedFields.GROQ_API_KEY;

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setSettingsError(null);
    try {
      onSaved(await onSave(draft));
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
    // aria-modal also tells the editor to leave the keyboard to this dialog.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Desktop settings"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
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
            <h2 className="mt-2 text-xl font-semibold">Local studio</h2>
            <p className="mt-1 max-w-lg text-xs leading-5 text-zinc-500">
              Projects, media, and the job queue stay on this computer. The Groq
              key is stored in the operating system credential manager and is
              only used for speech-to-text.
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

        <div className="grid gap-4 p-6">
          <label>
            <span className="mb-2 flex items-center justify-between text-xs font-medium text-zinc-300">
              Groq API key
              {groqSaved ? (
                <span className="flex items-center gap-1 text-[10px] font-normal text-lime-300/70">
                  <Check size={10} /> Saved
                </span>
              ) : null}
            </span>
            <input
              type="password"
              autoComplete="off"
              value={draft.GROQ_API_KEY ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  GROQ_API_KEY: event.target.value,
                }))
              }
              placeholder={
                groqSaved ? "Leave blank to keep saved value" : "gsk_..."
              }
              required={!groqSaved}
              className="h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-700 focus:border-lime-300/50 focus:ring-2 focus:ring-lime-300/10"
            />
          </label>
        </div>

        <div className="mx-6 rounded-xl border border-lime-300/15 bg-lime-300/5 p-3 text-xs leading-5 text-zinc-300">
          SQLite, uploaded media, transcripts, and rendered overlays are stored
          on this computer.
          <span className="mt-2 block break-all font-mono text-[10px] text-zinc-500">
            {snapshot.values.dataDir}
          </span>
        </div>

        <div className="mx-6 mt-4 flex items-center justify-between gap-5 rounded-xl border border-white/10 bg-black/20 p-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Gauge size={16} className="text-lime-300" />
              GPU frame acceleration
            </div>
            <p className="mt-1 max-w-md text-xs leading-5 text-zinc-500">
              Uses Chromium ANGLE for transforms, shadows, and compositing. VP9
              transparency encoding still uses the CPU. Disable this if a GPU
              driver or virtual machine causes rendering errors.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(draft.GPU_FRAME_ACCELERATION)}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                GPU_FRAME_ACCELERATION: !current.GPU_FRAME_ACCELERATION,
              }))
            }
            className={`relative h-7 w-12 shrink-0 rounded-full border transition ${
              draft.GPU_FRAME_ACCELERATION
                ? "border-lime-300/60 bg-lime-300"
                : "border-white/15 bg-zinc-800"
            }`}
          >
            <span
              className={`absolute top-1 size-[18px] rounded-full bg-black shadow transition-transform ${
                draft.GPU_FRAME_ACCELERATION
                  ? "translate-x-[25px]"
                  : "translate-x-1"
              }`}
            />
            <span className="sr-only">Toggle GPU frame acceleration</span>
          </button>
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
            {saving ? "Starting local studio…" : "Save and start"}
          </button>
        </div>
      </form>
    </div>
  );
}

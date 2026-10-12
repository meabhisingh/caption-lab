"use client";

import { CaptionComposition } from "@caption-generator/captions/composition";
import type { CaptionProject } from "@caption-generator/types";
import { Player } from "@remotion/player";
import { CircleAlert, LoaderCircle, Move, WandSparkles } from "lucide-react";
import { useMemo, useRef, type CSSProperties } from "react";
import type { PreviewBackdrop, SafeZone } from "@/lib/preview-settings";
import { usePlayback, useStudio } from "./studio-context";

const CHECKERBOARD: CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg,#242429 25%,transparent 25%),linear-gradient(-45deg,#242429 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#242429 75%),linear-gradient(-45deg,transparent 75%,#242429 75%)",
  backgroundSize: "22px 22px",
  backgroundPosition: "0 0,0 11px,11px -11px,-11px 0px",
};

const BACKDROPS: Record<
  PreviewBackdrop,
  { label: string; style: CSSProperties }
> = {
  transparent: { label: "Transparent canvas", style: CHECKERBOARD },
  dark: { label: "Dark backdrop", style: { backgroundColor: "#000000" } },
  light: { label: "Light backdrop", style: { backgroundColor: "#ffffff" } },
  green: { label: "Green screen", style: { backgroundColor: "#00b140" } },
  video: { label: "Source video", style: CHECKERBOARD },
};

// Rough share of a 9:16 screen each app covers with its own interface, in
// percent of the canvas. A guide for placing captions, not a specification.
const SAFE_ZONES: Record<
  Exclude<SafeZone, "none">,
  { label: string; top: number; bottom: number; left: number; right: number }
> = {
  tiktok: { label: "TikTok", top: 8, bottom: 22, left: 4, right: 13 },
  reels: { label: "Instagram Reels", top: 11, bottom: 20, left: 4, right: 10 },
  shorts: { label: "YouTube Shorts", top: 8, bottom: 18, left: 4, right: 12 },
};

function SafeZoneOverlay({ zone }: { zone: SafeZone }) {
  if (zone === "none") return null;
  const { label, top, bottom, left, right } = SAFE_ZONES[zone];
  const covered = "absolute bg-red-500/20";
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      <div
        className={`${covered} inset-x-0 top-0`}
        style={{ height: `${top}%` }}
      />
      <div
        className={`${covered} inset-x-0 bottom-0`}
        style={{ height: `${bottom}%` }}
      />
      <div
        className={`${covered} left-0`}
        style={{ top: `${top}%`, bottom: `${bottom}%`, width: `${left}%` }}
      />
      <div
        className={`${covered} right-0`}
        style={{ top: `${top}%`, bottom: `${bottom}%`, width: `${right}%` }}
      />
      <div
        className="absolute border border-dashed border-white/50"
        style={{
          top: `${top}%`,
          bottom: `${bottom}%`,
          left: `${left}%`,
          right: `${right}%`,
        }}
      />
      <span className="absolute left-1/2 top-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-white">
        {label} safe area (approx.)
      </span>
    </div>
  );
}

function StatusCard({ project }: { project: CaptionProject }) {
  const failed = project.status === "FAILED";
  const exporting = project.status === "EXPORTING";
  // Sized in container units: the canvas gets narrow in a short window.
  return (
    <div className="flex h-full flex-col items-center justify-center overflow-hidden bg-[#121216] px-[8cqw] text-center @container">
      <div
        className={`relative grid size-[22cqw] max-h-20 max-w-20 shrink-0 place-items-center rounded-full border ${
          failed
            ? "border-red-400/25 bg-red-400/5 text-red-300"
            : "border-lime-300/20 bg-lime-300/5 text-lime-300"
        }`}
      >
        {failed ? (
          <CircleAlert className="size-1/3" />
        ) : (
          <>
            <span className="absolute inset-0 animate-ping rounded-full border border-lime-300/20" />
            <WandSparkles className="size-1/3" />
          </>
        )}
      </div>
      <h3 className="mt-[6cqw] text-[clamp(12px,5.2cqw,18px)] font-semibold leading-tight">
        {failed
          ? "Transcription failed"
          : exporting
            ? "Rendering every frame"
            : "Listening for every word"}
      </h3>
      <p className="mt-2 max-w-xs break-words text-[clamp(10px,3.9cqw,14px)] leading-[1.6] text-zinc-500">
        {failed
          ? (project.error ??
            "Something went wrong. Start a new project to try again.")
          : exporting
            ? "Building your transparent VP9 overlay. Longer clips need a little more time."
            : "Extracting clean audio and generating word-level timestamps with Groq Whisper."}
      </p>
      {failed ? null : (
        <div className="mt-[7cqw] h-1.5 w-1/2 max-w-44 shrink-0 overflow-hidden rounded-full bg-white/5">
          <div className="h-full w-2/5 animate-[loading_1.4s_ease-in-out_infinite] rounded-full bg-lime-300" />
        </div>
      )}
    </div>
  );
}

function RenderProgressOverlay({ progress }: { progress: number }) {
  const safeProgress = Math.min(99, Math.max(1, progress));
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 px-8 backdrop-blur-[2px]">
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
        <p className="mt-3 text-[10px] leading-4 text-zinc-500">
          Rendering frames and encoding transparent VP9
        </p>
      </div>
    </div>
  );
}

/** Lets the caption block be dragged around the canvas. */
function DragToMove() {
  const { style, patchStyle } = useStudio();
  const drag = useRef<{
    pointerX: number;
    pointerY: number;
    startX: number;
    startY: number;
    width: number;
    height: number;
  } | null>(null);
  return (
    <div
      className="absolute inset-0 z-20 cursor-move touch-none"
      title="Drag to move the captions"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const box = event.currentTarget.getBoundingClientRect();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointerX: event.clientX,
          pointerY: event.clientY,
          startX: style.positionX,
          startY: style.positionY,
          width: box.width,
          height: box.height,
        };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        patchStyle(
          {
            positionX:
              start.startX +
              ((event.clientX - start.pointerX) / start.width) * 100,
            positionY:
              start.startY +
              ((event.clientY - start.pointerY) / start.height) * 100,
          },
          "drag-position",
        );
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    />
  );
}

/** The 9:16 canvas with the live caption preview. */
export function PreviewStage() {
  const {
    project,
    ready,
    locked,
    words,
    style,
    duration,
    fps,
    mediaSrc,
    preview,
    activeTab,
  } = useStudio();
  const { attachPlayer } = usePlayback();

  const showVideo =
    preview.backdrop === "video" &&
    project.mediaType === "VIDEO" &&
    Boolean(mediaSrc);
  const backdrop =
    BACKDROPS[
      preview.backdrop === "video" && !showVideo
        ? "transparent"
        : preview.backdrop
    ];
  const inputProps = useMemo(
    () => ({
      words,
      style,
      durationSeconds: duration,
      audioSrc: mediaSrc ?? undefined,
      includeAudio: true,
      videoSrc: showVideo ? (mediaSrc ?? undefined) : undefined,
    }),
    [duration, mediaSrc, showVideo, style, words],
  );
  // A caption hidden in the Layers tab cannot be dragged blind.
  const movable =
    activeTab === "layers" && ready && !locked && style.opacity > 0;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden p-5">
      <div className="absolute inset-0 opacity-40 bg-[radial-gradient(#303038_1px,transparent_1px)] bg-size-[20px_20px]" />
      <div className="relative flex h-full w-full items-center justify-center @container-size">
        <div
          className="relative overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/50"
          style={{
            ...backdrop.style,
            aspectRatio: "9 / 16",
            height: "min(100cqh, calc(100cqw * 16 / 9), 760px)",
          }}
        >
          {ready ? (
            <Player
              ref={attachPlayer}
              component={CaptionComposition}
              inputProps={inputProps}
              durationInFrames={Math.max(1, Math.ceil(duration * fps))}
              compositionWidth={project.width}
              compositionHeight={project.height}
              fps={fps}
              playbackRate={preview.playbackRate}
              clickToPlay
              doubleClickToFullscreen={false}
              spaceKeyToPlayOrPause={false}
              style={{ width: "100%", height: "100%" }}
            />
          ) : (
            <StatusCard project={project} />
          )}
          {ready ? <SafeZoneOverlay zone={preview.safeZone} /> : null}
          {movable ? <DragToMove /> : null}
          {locked ? (
            <RenderProgressOverlay progress={project.renderProgress} />
          ) : null}
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-black/70 px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-zinc-400 backdrop-blur">
        {movable ? (
          <>
            <Move size={11} /> Drag to move captions
          </>
        ) : (
          backdrop.label
        )}
      </div>
    </div>
  );
}

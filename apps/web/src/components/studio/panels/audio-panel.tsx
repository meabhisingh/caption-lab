"use client";

import type { CaptionWord } from "@caption-generator/types";
import { Pause, Play, SkipBack, Volume2, VolumeX } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { PLAYBACK_RATES } from "@/lib/preview-settings";
import { shiftWords } from "@/lib/word-edits";
import { usePlayback, useStudio, useStudioTime } from "../studio-context";
import {
  IconButton,
  PanelHeader,
  Section,
  SegmentedControl,
  SliderField,
  ToggleField,
  cn,
  formatPreciseTime,
  formatTime,
} from "../ui";

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300/70";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

// ---- Playback ---------------------------------------------------------------

const SPEED_OPTIONS: ReadonlyArray<{ value: number; label: string }> =
  PLAYBACK_RATES.map((rate) => ({ value: rate, label: `${rate}x` }));

/** The only part of the panel that re-renders on every frame. */
function CurrentTime() {
  const time = useStudioTime();
  return <span className="text-zinc-100">{formatPreciseTime(time)}</span>;
}

function PlaybackSection() {
  const { ready, duration, preview, setPreview } = useStudio();
  const { playing, volume, muted, toggle, seek, setVolume, setMuted } =
    usePlayback();
  const silent = muted || volume === 0;

  return (
    <Section title="Playback">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause (Space)" : "Play (Space)"}
          disabled={!ready}
          onClick={toggle}
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-full bg-lime-300 text-black transition hover:bg-lime-200 disabled:bg-zinc-800 disabled:text-zinc-500",
            FOCUS_RING,
          )}
        >
          {playing ? (
            <Pause size={16} fill="currentColor" />
          ) : (
            <Play size={16} fill="currentColor" className="translate-x-px" />
          )}
        </button>
        <p className="min-w-0 flex-1 font-mono text-sm tabular-nums text-zinc-600">
          <CurrentTime /> / {formatPreciseTime(duration)}
        </p>
        <IconButton
          label="Back to the start"
          disabled={!ready}
          onClick={() => seek(0)}
        >
          <SkipBack size={15} />
        </IconButton>
      </div>

      <div className="flex items-end gap-2">
        <IconButton
          label={silent ? "Unmute" : "Mute"}
          active={silent}
          disabled={!ready}
          onClick={() => {
            if (!silent) return setMuted(true);
            setMuted(false);
            // Unmuting a slider that sits at zero would stay silent.
            if (volume === 0) setVolume(0.5);
          }}
        >
          {silent ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </IconButton>
        <div className="min-w-0 flex-1">
          <SliderField
            label="Volume"
            value={muted ? 0 : Math.round(volume * 100)}
            min={0}
            max={100}
            format={(value) => `${value}%`}
            disabled={!ready}
            onChange={(value) => setVolume(value / 100)}
          />
        </div>
      </div>

      <SegmentedControl
        label="Speed"
        value={preview.playbackRate}
        options={SPEED_OPTIONS}
        onChange={(playbackRate) => setPreview({ playbackRate })}
      />
    </Section>
  );
}

// ---- Waveform ---------------------------------------------------------------

const BAR_WIDTH = 2;
const BAR_GAP = 1;
const BAR_ALPHA = 0.55;

const WAVEFORM_MESSAGES = {
  loading: "Reading the audio...",
  unavailable:
    "The waveform could not be loaded. Captions and export are not affected.",
  idle: "Available once the audio has been transcribed.",
} as const;

const drawPeaks = (canvas: HTMLCanvasElement, peaks: number[]) => {
  const context = canvas.getContext("2d");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!context || width === 0 || height === 0) return;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  // The canvas carries the accent as its text color, so no hex is repeated.
  context.fillStyle = getComputedStyle(canvas).color;
  context.globalAlpha = BAR_ALPHA;

  const bars = Math.max(1, Math.floor(width / (BAR_WIDTH + BAR_GAP)));
  const pitch = width / bars;
  const middle = height / 2;
  for (let bar = 0; bar < bars; bar += 1) {
    const from = Math.floor((bar / bars) * peaks.length);
    const to = Math.max(
      from + 1,
      Math.floor(((bar + 1) / bars) * peaks.length),
    );
    let peak = 0;
    for (let index = from; index < to && index < peaks.length; index += 1) {
      const value = peaks[index] ?? 0;
      if (value > peak) peak = value;
    }
    const half = Math.max(0.5, clamp(peak, 0, 1) * (middle - 3));
    context.fillRect(bar * pitch, middle - half, BAR_WIDTH, half * 2);
  }
};

/** The whole clip at a glance; click, drag or use the arrow keys to seek. */
function WaveformOverview({
  peaks,
  duration,
}: {
  peaks: number[];
  duration: number;
}) {
  const { seek, getTime, subscribeTime } = usePlayback();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => drawPeaks(canvas, peaks);
    draw();
    const observer = new ResizeObserver(draw);
    try {
      // Also reports browser zoom, which changes the pixels but not the size.
      observer.observe(canvas, { box: "device-pixel-content-box" });
    } catch {
      observer.observe(canvas);
    }
    return () => observer.disconnect();
  }, [peaks]);

  // The playhead follows playback outside React, so nothing re-renders.
  useEffect(() => {
    let announced = "";
    const update = () => {
      const time = clamp(getTime(), 0, duration);
      const playhead = playheadRef.current;
      if (playhead)
        playhead.style.left = `calc(${duration > 0 ? time / duration : 0} * (100% - 2px))`;
      const track = trackRef.current;
      const value = time.toFixed(1);
      if (!track || value === announced) return;
      announced = value;
      track.setAttribute("aria-valuenow", value);
      track.setAttribute(
        "aria-valuetext",
        `${formatTime(time)} of ${formatTime(duration)}`,
      );
    };
    update();
    return subscribeTime(update);
  }, [duration, getTime, subscribeTime]);

  const seekToPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || duration <= 0) return;
    seek(clamp((event.clientX - box.left) / box.width, 0, 1) * duration);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 5 : 1;
    const target =
      event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? getTime() - step
        : event.key === "ArrowRight" || event.key === "ArrowUp"
          ? getTime() + step
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? duration
              : null;
    if (target === null) return;
    event.preventDefault();
    seek(clamp(target, 0, duration));
  };

  return (
    <div>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Seek in the clip"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Number(duration.toFixed(1))}
        // Kept current by the effect above; a prop would re-render per frame.
        aria-valuenow={0}
        title="Click or drag to seek"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          seekToPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            seekToPointer(event);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          "relative h-14 cursor-pointer touch-none overflow-hidden rounded-lg border border-white/10 bg-black/30",
          FOCUS_RING,
        )}
      >
        <canvas
          ref={canvasRef}
          aria-hidden
          className="block size-full text-lime-300"
        />
        <div
          ref={playheadRef}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-white"
        />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-zinc-600">
        <span>0:00</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}

function WaveformSection() {
  const { waveform, duration, preview, setPreview } = useStudio();
  return (
    <Section title="Waveform">
      <ToggleField
        label="Show on the timeline"
        checked={preview.showWaveform}
        onChange={(showWaveform) => setPreview({ showWaveform })}
      />
      {waveform.status === "ready" ? (
        <WaveformOverview peaks={waveform.peaks} duration={duration} />
      ) : (
        <p
          role="status"
          className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs leading-5 text-zinc-500"
        >
          {WAVEFORM_MESSAGES[waveform.status]}
        </p>
      )}
    </Section>
  );
}

// ---- Caption sync -----------------------------------------------------------

const NUDGES_MS = [-100, -50, 50, 100] as const;
const SHIFT_COALESCE_KEY = "shift-words";

const signed = (ms: number) => `${ms > 0 ? "+" : ""}${ms}`;

type SyncPoint = {
  /** Shift this timing stands for, in milliseconds. */
  total: number;
  /**
   * The words as they were before any shift, never clamped to the clip. Each
   * shift starts from these, so a caption pushed against the start or the end
   * of the clip gets its own timing back when the shift is reversed.
   */
  origin: CaptionWord[];
};

type SyncSession = {
  /** Shift applied so far, in milliseconds. */
  total: number;
  /** Every timing this panel has produced, by signature. */
  known: Readonly<Record<string, SyncPoint | undefined>>;
};

const EMPTY_SESSION: SyncSession = { total: 0, known: {} };

/**
 * Identifies the timing of a transcript, so the total can follow undo and
 * redo: stepping back to a timing this panel produced restores its total.
 */
const timingSignature = (words: CaptionWord[]) => {
  let starts = 0;
  let ends = 0;
  for (const word of words) {
    starts += Math.round(word.start * 1000);
    ends += Math.round(word.end * 1000);
  }
  return `${words.length}:${starts}:${ends}`;
};

const sameWords = (a: CaptionWord[], b: CaptionWord[]) =>
  a.length === b.length &&
  a.every((word, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      word.text === other.text &&
      word.start === other.start &&
      word.end === other.end
    );
  });

const SYNC_BUTTON =
  "rounded-lg border border-white/10 text-zinc-300 transition hover:border-lime-300/40 hover:text-lime-300 disabled:border-white/10 disabled:text-zinc-300 disabled:opacity-40";

function SyncSection() {
  const { ready, locked, duration, words, setWords, restoreCount } =
    useStudio();
  const disabled = locked || !ready;

  const [session, setSession] = useState(EMPTY_SESSION);
  // Restoring the original transcript replaces the words outright, so any
  // shift counted so far no longer describes them.
  const [seenRestore, setSeenRestore] = useState(restoreCount);
  if (seenRestore !== restoreCount) {
    setSeenRestore(restoreCount);
    setSession(EMPTY_SESSION);
  }

  const signature = useMemo(() => timingSignature(words), [words]);
  const point = session.known[signature];
  const recognised = point?.total;
  // An undo or redo landed on a timing with a different total.
  if (recognised !== undefined && recognised !== session.total)
    setSession({ ...session, total: recognised });
  const total = recognised ?? session.total;

  const [draft, setDraft] = useState("");
  const limitMs = Math.round(duration * 1000);
  const parsed = draft.trim() === "" ? Number.NaN : Number(draft);
  const customMs =
    Number.isFinite(parsed) && Math.round(parsed) !== 0
      ? clamp(Math.round(parsed), -limitMs, limitMs)
      : null;

  const shiftBy = (ms: number, coalesceKey?: string) => {
    if (disabled || ms === 0) return;
    // The remembered origin only holds while the words are still the ones
    // this panel produced; after an edit elsewhere it is rebuilt from them.
    const origin =
      point &&
      sameWords(shiftWords(point.origin, point.total / 1000, duration), words)
        ? point.origin
        : words.map((word) => ({
            ...word,
            start: word.start - total / 1000,
            end: word.end - total / 1000,
          }));
    const next = shiftWords(origin, (total + ms) / 1000, duration);
    const after = timingSignature(next);
    // Every caption already sits against that end of the clip.
    if (after === signature) return;
    setWords(
      (current) =>
        current === words ? next : shiftWords(current, ms / 1000, duration),
      coalesceKey,
    );
    setSession({
      total: total + ms,
      known: {
        ...session.known,
        [signature]: { total, origin },
        [after]: { total: total + ms, origin },
      },
    });
  };

  const applyCustom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (customMs !== null) shiftBy(customMs);
  };

  return (
    <Section title="Caption sync">
      <p className="text-xs leading-5 text-zinc-500">
        Moves every caption earlier or later when they do not line up with the
        speech.
      </p>

      <div
        role="group"
        aria-label="Shift every caption"
        className="grid grid-cols-4 gap-1.5"
      >
        {NUDGES_MS.map((ms) => (
          <button
            key={ms}
            type="button"
            disabled={disabled}
            title={`${Math.abs(ms)} ms ${ms < 0 ? "earlier" : "later"}`}
            onClick={() => shiftBy(ms, SHIFT_COALESCE_KEY)}
            className={cn(
              SYNC_BUTTON,
              FOCUS_RING,
              "h-8 font-mono text-[11px] font-medium",
            )}
          >
            {signed(ms)} ms
          </button>
        ))}
      </div>

      {/* Values are clamped here, so the browser's step check must not block Enter. */}
      <form onSubmit={applyCustom} noValidate className="flex items-end gap-2">
        <label className="block min-w-0 flex-1 text-xs text-zinc-400">
          Custom shift in milliseconds
          <input
            type="number"
            inputMode="numeric"
            step={10}
            min={-limitMs}
            max={limitMs}
            value={draft}
            disabled={disabled}
            placeholder="-250 is a quarter second earlier"
            onChange={(event) => setDraft(event.target.value)}
            // The dark scheme keeps the browser's stepper arrows from showing as a white box.
            className="mt-2 h-9 w-full rounded-lg border border-white/10 bg-[#17171b] px-2 font-mono text-xs text-zinc-200 outline-none scheme-dark placeholder:font-sans placeholder:text-zinc-600 focus:border-lime-300/50 disabled:opacity-40"
          />
        </label>
        <button
          type="submit"
          disabled={disabled || customMs === null}
          className={cn(
            SYNC_BUTTON,
            FOCUS_RING,
            "h-9 px-3.5 text-xs font-semibold",
          )}
        >
          Apply
        </button>
      </form>

      <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-white/2 py-1.5 pl-3 pr-1.5">
        <p
          aria-live="polite"
          className={cn(
            "text-xs",
            total === 0 ? "text-zinc-600" : "text-zinc-300",
          )}
        >
          {total === 0 ? (
            "No shift applied yet"
          ) : (
            <>
              Shifted{" "}
              <span className="text-lime-300">
                <span className="font-mono">{signed(total)}</span> ms
              </span>{" "}
              in total
            </>
          )}
        </p>
        {total === 0 ? null : (
          <button
            type="button"
            disabled={disabled}
            title="Move the captions back by the total"
            onClick={() => shiftBy(-total)}
            className={cn(
              SYNC_BUTTON,
              FOCUS_RING,
              "h-7 px-2.5 text-[11px] font-medium",
            )}
          >
            Reset
          </button>
        )}
      </div>
    </Section>
  );
}

// ---- Source -----------------------------------------------------------------

function SourceSection() {
  const { project, duration, words } = useStudio();
  const facts: Array<{ label: string; value: string; title?: string }> = [
    { label: "File", value: project.fileName, title: project.fileName },
    { label: "Type", value: project.mediaType === "VIDEO" ? "Video" : "Audio" },
    {
      label: "Duration",
      value: duration > 0 ? formatPreciseTime(duration) : "Not known yet",
    },
    {
      label: "Words",
      value: words.length > 0 ? words.length.toLocaleString() : "None yet",
    },
  ];
  if (duration > 0 && words.length > 0)
    facts.push({
      label: "Speaking rate",
      value: `${Math.round((words.length / duration) * 60)} words per minute`,
    });

  return (
    <Section title="Source">
      <dl className="space-y-2.5 text-xs">
        {facts.map((fact) => (
          <div
            key={fact.label}
            className="flex items-baseline justify-between gap-4"
          >
            <dt className="shrink-0 text-zinc-500">{fact.label}</dt>
            <dd className="min-w-0 truncate text-zinc-200" title={fact.title}>
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export function AudioPanel() {
  return (
    <>
      <PanelHeader
        title="Audio"
        description="Listen, check the waveform, and line captions up with the speech."
      />
      <PlaybackSection />
      <WaveformSection />
      <SyncSection />
      <SourceSection />
    </>
  );
}

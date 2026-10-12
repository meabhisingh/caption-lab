"use client";

import { WORD_LIMITS, cleanWordText } from "@caption-generator/captions";
import type { CaptionWord } from "@caption-generator/types";
import { Maximize2, Pause, Play, ZoomIn, ZoomOut } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  TIMELINE_HEIGHT,
  TIMELINE_ZOOM,
  maxTimelineZoom,
} from "@/lib/preview-settings";
import { retimeWord, setWordText } from "@/lib/word-edits";
import {
  useActiveWordIndex,
  useIsWordActive,
  usePlayback,
  useStudio,
  useStudioTime,
} from "./studio-context";
import { IconButton, cn, formatPreciseTime, formatTime } from "./ui";

/** Height the canvas above the timeline always keeps, in pixels. */
const CANVAS_RESERVE = 280;
/** Space left and right of the clip so the first and last frame are not at the very edge. */
const GUTTER = 12;
const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 6, 8, 12] as const;
const WHEEL_ZOOM_RATE = 0.0022;

/** Seconds between ruler labels, and how many ticks each interval is cut into. */
const RULER_SCALES = [
  { step: 0.1, parts: 2 },
  { step: 0.25, parts: 5 },
  { step: 0.5, parts: 5 },
  { step: 1, parts: 4 },
  { step: 2, parts: 4 },
  { step: 5, parts: 5 },
  { step: 10, parts: 5 },
  { step: 15, parts: 3 },
  { step: 30, parts: 6 },
  { step: 60, parts: 4 },
  { step: 120, parts: 4 },
  { step: 300, parts: 5 },
  { step: 600, parts: 5 },
  { step: 1800, parts: 6 },
  { step: 3600, parts: 4 },
] as const;
const LABEL_SPACING = 72;
/** Room a label needs before the end of the clip, or it would be cut off. */
const LABEL_ROOM = 44;

// Only the words near the scrolled viewport are rendered. The viewport is
// tracked in coarse steps so scrolling re-renders the tracks a few times, not
// on every pixel.
const SCROLL_CHUNK = 240;
const OVERSCAN = 320;

/** Narrower blocks show no text; blocks up to the second width cut it off without an ellipsis. */
const MIN_TEXT_WIDTH = 16;
const ELLIPSIS_WIDTH = 46;
const MIN_HANDLE_WIDTH = 30;
/** Words that start closer together than this, in pixels, share one block. */
const MIN_BLOCK_PITCH = 1.5;
const EDITOR_MIN_WIDTH = 104;
const FOLLOW_PAUSE_MS = 1500;

const clampZoom = (zoom: number, max: number) =>
  Math.round(Math.min(max, Math.max(TIMELINE_ZOOM.min, zoom)) * 100) / 100;

// The fixed steps cover short clips; beyond them each step doubles, up to the
// clip's own limit.
const zoomedIn = (zoom: number, max: number) =>
  Math.min(max, ZOOM_STEPS.find((step) => step > zoom + 0.001) ?? zoom * 2);

const zoomedOut = (zoom: number) => {
  const last = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? TIMELINE_ZOOM.max;
  return zoom > last * 2
    ? Math.ceil(zoom / 2)
    : (ZOOM_STEPS.findLast((step) => step < zoom - 0.001) ?? TIMELINE_ZOOM.min);
};

const formatZoom = (zoom: number) => `${Number(zoom.toFixed(1))}x`;

const formatTick = (seconds: number, step: number) => {
  if (step >= 1) return formatTime(seconds);
  const digits = step === 0.25 ? 2 : 1;
  return `${Math.floor(seconds / 60)}:${(seconds % 60)
    .toFixed(digits)
    .padStart(3 + digits, "0")}`;
};

/** Index of the first word that starts at or after a time. */
const firstWordFrom = (words: CaptionWord[], time: number) => {
  let low = 0;
  let high = words.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const word = words[middle];
    if (word && word.start < time) low = middle + 1;
    else high = middle;
  }
  return low;
};

function TimeReadout({ duration }: { duration: number }) {
  const time = useStudioTime();
  return (
    <span
      role="timer"
      className="whitespace-nowrap font-mono text-[11px] tabular-nums text-zinc-200"
      aria-label="Playhead position"
    >
      {formatPreciseTime(Math.min(time, duration))}
      <span className="text-zinc-600"> / {formatPreciseTime(duration)}</span>
    </span>
  );
}

function TransportBar() {
  const { ready, locked, duration, fps, preview, setPreview } = useStudio();
  const { playing, toggle } = usePlayback();
  const maxZoom = maxTimelineZoom(duration);
  const zoom = Math.min(preview.timelineZoom, maxZoom);
  const zoomIn = () => setPreview({ timelineZoom: zoomedIn(zoom, maxZoom) });
  const zoomOut = () => setPreview({ timelineZoom: zoomedOut(zoom) });

  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b border-white/[0.07] pl-3 pr-2 text-xs text-zinc-500">
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause (Space)" : "Play (Space)"}
        disabled={!ready}
        onClick={toggle}
        className="grid size-7 shrink-0 place-items-center rounded-full bg-lime-300 text-black transition hover:bg-lime-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300 disabled:cursor-default disabled:bg-zinc-800 disabled:text-zinc-600"
      >
        {playing ? (
          <Pause size={13} fill="currentColor" />
        ) : (
          <Play size={13} fill="currentColor" className="translate-x-px" />
        )}
      </button>
      <TimeReadout duration={duration} />
      <span className="whitespace-nowrap font-mono text-[10px] uppercase tracking-wider text-zinc-600">
        {fps} fps
      </span>
      <p className="min-w-0 flex-1 truncate text-right text-[11px] text-zinc-600">
        {ready && !locked
          ? "Double-click a word to edit it · zoom in to drag its edges"
          : null}
      </p>
      <div
        role="group"
        aria-label="Timeline zoom"
        className="flex shrink-0 items-center gap-0.5"
      >
        <IconButton
          label="Zoom out"
          disabled={!ready || zoom <= TIMELINE_ZOOM.min}
          onClick={zoomOut}
        >
          <ZoomOut size={15} />
        </IconButton>
        <span
          className="w-9 text-center font-mono text-[11px] tabular-nums text-zinc-400"
          aria-label={`Zoom ${formatZoom(zoom)}`}
        >
          {formatZoom(zoom)}
        </span>
        <IconButton
          label="Zoom in"
          disabled={!ready || zoom >= maxZoom}
          onClick={zoomIn}
        >
          <ZoomIn size={15} />
        </IconButton>
        <IconButton
          label="Fit the whole clip"
          disabled={!ready || zoom <= TIMELINE_ZOOM.min}
          onClick={() => setPreview({ timelineZoom: TIMELINE_ZOOM.min })}
        >
          <Maximize2 size={14} />
        </IconButton>
      </div>
    </div>
  );
}

const Ruler = memo(function Ruler({
  duration,
  pxPerSecond,
  fromTime,
  toTime,
}: {
  duration: number;
  pxPerSecond: number;
  fromTime: number;
  toTime: number;
}) {
  const scale =
    RULER_SCALES.find(({ step }) => step * pxPerSecond >= LABEL_SPACING) ??
    RULER_SCALES[RULER_SCALES.length - 1];
  if (!scale) return null;
  const tick = scale.step / scale.parts;
  const ticks: Array<{ at: number; time: number; major: boolean }> = [];
  const lastTick = Math.floor(Math.min(toTime, duration) / tick + 1e-6);
  for (
    let at = Math.max(0, Math.floor(fromTime / tick));
    at <= lastTick;
    at += 1
  )
    ticks.push({
      at,
      time: Math.round(at * tick * 1000) / 1000,
      major: at % scale.parts === 0,
    });

  return (
    <div className="pointer-events-none relative mx-3 h-full" aria-hidden>
      {ticks.map(({ at, time, major }) => (
        <div
          key={at}
          className="absolute inset-y-0"
          style={{ left: `${(time / duration) * 100}%` }}
        >
          <span
            className={cn(
              "absolute bottom-0 left-0 w-px",
              major ? "h-2.5 bg-white/30" : "h-1 bg-white/[0.14]",
            )}
          />
          {major && (duration - time) * pxPerSecond >= LABEL_ROOM ? (
            <span className="absolute left-1.5 top-[5px] whitespace-nowrap font-mono text-[10px] leading-none text-zinc-500">
              {formatTick(time, scale.step)}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
});

const WordBlock = memo(function WordBlock({
  index,
  text,
  start,
  end,
  duration,
  alternate,
  selected,
  tabbable,
  label,
  onSelect,
  onEdit,
  onNavigate,
}: {
  index: number;
  text: string;
  start: number;
  end: number;
  duration: number;
  /** The word sits on an odd caption line. */
  alternate: boolean;
  selected: boolean;
  tabbable: boolean;
  label: "none" | "clipped" | "full";
  onSelect: (index: number) => void;
  onEdit: (index: number) => void;
  onNavigate: (index: number) => void;
}) {
  const active = useIsWordActive(index);
  const left = Math.min(100, (start / duration) * 100);
  const width = Math.max(
    0,
    Math.min(100 - left, ((end - start) / duration) * 100),
  );
  return (
    <button
      type="button"
      data-timeline-item
      data-word-index={index}
      tabIndex={tabbable ? 0 : -1}
      aria-pressed={selected}
      aria-label={`${text}, ${formatPreciseTime(start)} to ${formatPreciseTime(end)}`}
      title={text}
      onClick={() => onSelect(index)}
      onDoubleClick={() => onEdit(index)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          onNavigate(index + (event.key === "ArrowRight" ? 1 : -1));
        } else if (event.key === "F2" || (event.key === "Enter" && selected)) {
          event.preventDefault();
          onEdit(index);
        }
      }}
      className={cn(
        "absolute inset-y-0 min-w-[3px] overflow-hidden rounded-[5px] border text-left text-[11px] font-medium leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
        active
          ? "border-lime-200 bg-lime-300 text-black"
          : alternate
            ? "border-white/[0.14] bg-white/[0.15] text-zinc-100 hover:bg-white/[0.22]"
            : "border-white/[0.07] bg-white/[0.07] text-zinc-300 hover:bg-white/[0.14]",
        selected &&
          "z-10 ring-2 ring-lime-300 ring-offset-1 ring-offset-[#0c0c0f]",
      )}
      style={{ left: `${left}%`, width: `calc(${width}% - 1px)` }}
    >
      {label === "none" ? null : (
        <span
          className={cn(
            "block overflow-hidden whitespace-nowrap",
            label === "full" ? "text-ellipsis px-1.5" : "px-[3px]",
            // Keeps the text clear of the grips on the selected word.
            selected && label === "full" && "px-3",
          )}
        >
          {text}
        </span>
      )}
    </button>
  );
});

/**
 * The word at the playhead, drawn on its own. Shown when the words are packed
 * so tightly that not every one of them has a block.
 */
function ActiveWordMarker({
  words,
  duration,
}: {
  words: CaptionWord[];
  duration: number;
}) {
  const index = useActiveWordIndex();
  const word = words[index];
  if (!word) return null;
  const left = Math.min(100, (word.start / duration) * 100);
  const width = Math.max(
    0,
    Math.min(100 - left, ((word.end - word.start) / duration) * 100),
  );
  return (
    <span
      aria-hidden
      data-timeline-active-word
      className="pointer-events-none absolute inset-y-0 z-[5] min-w-[3px] rounded-[5px] border border-lime-200 bg-lime-300"
      style={{ left: `${left}%`, width: `calc(${width}% - 1px)` }}
    />
  );
}

/** The text field shown over a word while it is being renamed. */
function WordEditor({
  text,
  left,
  width,
  onCommit,
  onCancel,
}: {
  text: string;
  /** In percent of the track. */
  left: number;
  width: number;
  onCommit: (text: string, viaKeyboard: boolean) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(text);
  const input = useRef<HTMLInputElement>(null);
  // Enter and Escape remove the field, which can blur it once more.
  const closed = useRef(false);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);
  const close = (commit: boolean, viaKeyboard: boolean) => {
    if (closed.current) return;
    closed.current = true;
    if (commit) onCommit(value, viaKeyboard);
    else onCancel();
  };
  return (
    <input
      ref={input}
      data-timeline-item
      type="text"
      value={value}
      maxLength={WORD_LIMITS.textLength}
      spellCheck={false}
      autoComplete="off"
      aria-label={`Text of the word “${text}”`}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => close(true, false)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          close(true, true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          close(false, true);
        }
      }}
      className="absolute inset-y-0 z-40 select-text rounded-[5px] border border-lime-300 bg-[#17171b] px-1.5 text-[11px] font-medium text-white shadow-lg shadow-black/60 outline-none ring-2 ring-lime-300/25"
      style={{
        left: `min(${left}%, calc(100% - ${EDITOR_MIN_WIDTH}px))`,
        width: `max(${width}%, ${EDITOR_MIN_WIDTH}px)`,
      }}
    />
  );
}

type Edge = "start" | "end";

/** The two grips on the selected word that move its start and end. */
function WordHandles({
  word,
  earliest,
  latest,
  duration,
  fps,
  pxPerSecond,
  onRetime,
  onHeldChange,
}: {
  word: CaptionWord;
  /** Where the previous word ends. */
  earliest: number;
  /** Where the next word starts. */
  latest: number;
  duration: number;
  fps: number;
  pxPerSecond: number;
  /** `gesture` names one drag or one run of key presses, for the undo history. */
  onRetime: (edge: Edge, seconds: number, gesture: string) => void;
  /** A grip is being dragged or has the focus, so the grips must stay. */
  onHeldChange: (held: boolean) => void;
}) {
  const drag = useRef<{
    edge: Edge;
    pointerX: number;
    start: number;
    end: number;
    gesture: string;
  } | null>(null);
  const focused = useRef(false);
  const shortest = Math.max(WORD_LIMITS.duration, 1 / fps);

  // Removing a focused element fires no blur, so the hold is let go here.
  useEffect(() => () => onHeldChange(false), [onHeldChange]);
  const endDrag = () => {
    drag.current = null;
    onHeldChange(focused.current);
  };

  // A word that already overlaps a neighbour may keep doing so; a drag never
  // makes the overlap larger.
  const limit = (edge: Edge, from: { start: number; end: number }) =>
    edge === "start"
      ? {
          min: Math.min(earliest, from.start),
          max: Math.max(from.start, from.end - shortest),
        }
      : {
          min: Math.min(from.end, from.start + shortest),
          max: Math.max(latest, from.end),
        };
  const clampTo = (
    edge: Edge,
    from: { start: number; end: number },
    value: number,
  ) => {
    const { min, max } = limit(edge, from);
    return Math.min(max, Math.max(min, value));
  };

  const grip = (edge: Edge) => {
    const value = word[edge];
    const range = limit(edge, word);
    return (
      <div
        role="slider"
        tabIndex={0}
        data-timeline-item
        data-word-handle={edge}
        aria-label={`${edge === "start" ? "Start" : "End"} of “${word.text}”`}
        aria-orientation="horizontal"
        aria-valuemin={Number(range.min.toFixed(3))}
        aria-valuemax={Number(range.max.toFixed(3))}
        aria-valuenow={value}
        aria-valuetext={formatPreciseTime(value)}
        title={`Drag to change when “${word.text}” ${edge === "start" ? "starts" : "ends"}`}
        className={cn(
          "group/grip absolute inset-y-0 z-20 flex w-2.5 cursor-ew-resize touch-none items-center justify-center outline-none",
          edge === "end" && "-translate-x-full",
        )}
        style={{
          left: `${Math.min(100, (Math.min(value, duration) / duration) * 100)}%`,
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            edge,
            pointerX: event.clientX,
            start: word.start,
            end: word.end,
            // Two quick drags in a row stay two undo steps.
            gesture: `drag-${Math.round(event.timeStamp)}`,
          };
          onHeldChange(true);
        }}
        onPointerMove={(event) => {
          const from = drag.current;
          if (!from || from.edge !== edge) return;
          const moved = (event.clientX - from.pointerX) / pxPerSecond;
          onRetime(edge, clampTo(edge, from, from[edge] + moved), from.gesture);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onFocus={() => {
          focused.current = true;
          onHeldChange(true);
        }}
        onBlur={(event) => {
          // Tabbing to the other grip keeps the hold.
          if (
            event.relatedTarget instanceof Element &&
            event.relatedTarget.hasAttribute("data-word-handle")
          )
            return;
          focused.current = false;
          onHeldChange(drag.current !== null);
        }}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          event.stopPropagation();
          const frames =
            (event.shiftKey ? 10 : 1) * (event.key === "ArrowRight" ? 1 : -1);
          onRetime(edge, clampTo(edge, word, value + frames / fps), "keys");
        }}
      >
        <span className="h-3/5 min-h-3 w-[3px] rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.65)] transition group-hover/grip:h-4/5 group-focus-visible/grip:h-full group-focus-visible/grip:bg-lime-100" />
      </div>
    );
  };

  return (
    <>
      {grip("start")}
      {grip("end")}
    </>
  );
}

function WordsTrack({
  fromTime,
  toTime,
  pxPerSecond,
}: {
  fromTime: number;
  toTime: number;
  pxPerSecond: number;
}) {
  const {
    words,
    style,
    duration,
    fps,
    locked,
    selectedWordIndex,
    selectWord,
    setWords,
  } = useStudio();
  const lane = useRef<HTMLDivElement>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  // While a grip is in use the grips stay, even on a word that a drag has
  // made too narrow for them; otherwise the drag would end under the pointer.
  const [gripsHeld, setGripsHeld] = useState(false);
  // An export started while a word was being renamed: drop the edit.
  if (locked && editingIndex !== null) setEditingIndex(null);
  const editing = locked ? null : editingIndex;
  /** The block that takes the focus after the next selection or edit. */
  const focusTarget = useRef<number | null>(null);

  useEffect(() => {
    const target = focusTarget.current;
    if (target === null) return;
    focusTarget.current = null;
    lane.current
      ?.querySelector<HTMLElement>(`[data-word-index="${target}"]`)
      ?.focus({ preventScroll: true });
  }, [selectedWordIndex, editingIndex]);

  const visible = useMemo(() => {
    let first = firstWordFrom(words, fromTime);
    // Words that started earlier can still reach into the viewport.
    for (let back = 0; back < 64 && first > 0; back += 1) {
      const previous = words[first - 1];
      if (!previous || previous.end < fromTime) break;
      first -= 1;
    }
    const end = firstWordFrom(words, toTime + 1e-6);
    const column = (index: number) =>
      Math.floor(((words[index]?.start ?? 0) * pxPerSecond) / MIN_BLOCK_PITCH);
    const indices: number[] = [];
    let dense = false;
    for (let index = first; index < end; index += 1) {
      // A long clip seen whole packs many words into the same pixels. Only
      // the first of them is drawn: thousands of slivers on top of each
      // other show nothing more and make every repaint slow.
      if (
        index > 0 &&
        index !== selectedWordIndex &&
        index !== editing &&
        column(index) === column(index - 1)
      ) {
        dense = true;
        continue;
      }
      indices.push(index);
    }
    // The selected word stays mounted so it can hold the keyboard focus.
    for (const extra of [selectedWordIndex, editing])
      if (
        extra !== null &&
        extra < words.length &&
        (extra < first || extra >= end) &&
        !indices.includes(extra)
      )
        indices.push(extra);
    return { indices, dense };
  }, [words, fromTime, toTime, pxPerSecond, selectedWordIndex, editing]);

  const select = useCallback(
    (index: number) => selectWord(index, { seek: true }),
    [selectWord],
  );
  const edit = useCallback(
    (index: number) => {
      if (locked) return;
      selectWord(index);
      setEditingIndex(index);
    },
    [locked, selectWord],
  );
  const count = words.length;
  const navigate = useCallback(
    (index: number) => {
      if (index < 0 || index >= count) return;
      focusTarget.current = index;
      selectWord(index, { seek: true });
    },
    [count, selectWord],
  );

  const pageSize = Math.max(1, style.maxWords);
  const tabStop = selectedWordIndex ?? visible.indices[0] ?? 0;
  const selected =
    selectedWordIndex === null ? undefined : words[selectedWordIndex];
  const edited = editing === null ? undefined : words[editing];
  const percent = (seconds: number) =>
    Math.min(100, (Math.min(seconds, duration) / duration) * 100);

  return (
    <div
      ref={lane}
      role="group"
      aria-label="Caption words"
      className="relative mx-3 h-full"
    >
      {visible.dense ? (
        <ActiveWordMarker words={words} duration={duration} />
      ) : null}
      {visible.indices.map((index) => {
        const word = words[index];
        if (!word) return null;
        const width = (word.end - word.start) * pxPerSecond;
        return (
          <WordBlock
            key={index}
            index={index}
            text={word.text}
            start={word.start}
            end={word.end}
            duration={duration}
            alternate={Math.floor(index / pageSize) % 2 === 1}
            selected={index === selectedWordIndex}
            tabbable={index === tabStop}
            label={
              width >= ELLIPSIS_WIDTH
                ? "full"
                : width >= MIN_TEXT_WIDTH
                  ? "clipped"
                  : "none"
            }
            onSelect={select}
            onEdit={edit}
            onNavigate={navigate}
          />
        );
      })}
      {selected &&
      selectedWordIndex !== null &&
      !locked &&
      editing === null &&
      (gripsHeld ||
        (selected.end - selected.start) * pxPerSecond >= MIN_HANDLE_WIDTH) ? (
        <WordHandles
          key={selectedWordIndex}
          word={selected}
          earliest={words[selectedWordIndex - 1]?.end ?? 0}
          latest={words[selectedWordIndex + 1]?.start ?? duration}
          duration={duration}
          fps={fps}
          pxPerSecond={pxPerSecond}
          onRetime={(edge, seconds, gesture) =>
            setWords(
              (current) =>
                retimeWord(
                  current,
                  selectedWordIndex,
                  edge === "start" ? { start: seconds } : { end: seconds },
                  duration,
                ),
              `timeline-retime-${selectedWordIndex}-${edge}-${gesture}`,
            )
          }
          onHeldChange={setGripsHeld}
        />
      ) : null}
      {edited && editing !== null ? (
        <WordEditor
          key={editing}
          text={edited.text}
          left={percent(edited.start)}
          width={percent(edited.end) - percent(edited.start)}
          onCommit={(text, viaKeyboard) => {
            const cleaned = cleanWordText(text);
            if (cleaned && cleaned !== edited.text)
              setWords((current) =>
                setWordText(current, editing, cleaned, duration),
              );
            if (viaKeyboard) focusTarget.current = editing;
            setEditingIndex(null);
          }}
          onCancel={() => {
            focusTarget.current = editing;
            setEditingIndex(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The loudness of the clip. The canvas is as wide as the viewport and stays
 * in place while the track scrolls; it draws the part that is in view, so its
 * size does not grow with the zoom.
 */
function WaveformTrack({
  peaks,
  scroller,
  viewportWidth,
  laneWidth,
}: {
  peaks: number[];
  scroller: RefObject<HTMLDivElement | null>;
  viewportWidth: number;
  laneWidth: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const surface = canvas.current;
    const viewport = scroller.current;
    if (!surface || !viewport) return;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const width = surface.clientWidth;
      const height = surface.clientHeight;
      const context = surface.getContext("2d");
      if (!context || width <= 0 || height <= 0) return;
      const ratio = Math.min(3, window.devicePixelRatio || 1);
      const pixelWidth = Math.round(width * ratio);
      const pixelHeight = Math.round(height * ratio);
      if (surface.width !== pixelWidth) surface.width = pixelWidth;
      if (surface.height !== pixelHeight) surface.height = pixelHeight;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "rgba(161, 161, 170, 0.5)";

      const bar = 2;
      const pitch = 3;
      const scrolled = viewport.scrollLeft;
      const room = Math.max(2, height - 6);
      // Bars sit on a grid fixed to the clip, so they do not shimmer on scroll.
      for (
        let x = Math.floor(scrolled / pitch) * pitch;
        x < scrolled + width;
        x += pitch
      ) {
        const from = (x - GUTTER) / laneWidth;
        const to = (x + pitch - GUTTER) / laneWidth;
        if (to <= 0 || from >= 1) continue;
        const first = Math.max(0, Math.floor(from * peaks.length));
        const last = Math.min(
          peaks.length,
          Math.max(first + 1, Math.ceil(to * peaks.length)),
        );
        let peak = 0;
        for (let index = first; index < last; index += 1)
          peak = Math.max(peak, peaks[index] ?? 0);
        const size = Math.max(1.5, peak * room);
        context.fillRect(x - scrolled, (height - size) / 2, bar, size);
      }
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(surface);
    viewport.addEventListener("scroll", schedule, { passive: true });
    draw();
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      observer.disconnect();
      viewport.removeEventListener("scroll", schedule);
    };
  }, [peaks, laneWidth, scroller]);

  return (
    <div className="sticky left-0 h-full" style={{ width: viewportWidth }}>
      <canvas
        ref={canvas}
        role="img"
        aria-label="Audio waveform"
        data-timeline-waveform
        className="block h-full w-full"
      />
    </div>
  );
}

function Tracks() {
  const { duration, fps, preview, setPreview, waveform } = useStudio();
  const { playing, seek, getTime, subscribeTime } = usePlayback();
  // The stored zoom may come from a longer clip with a higher limit.
  const maxZoom = maxTimelineZoom(duration);
  const zoom = Math.min(preview.timelineZoom, maxZoom);

  const scroller = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [scrollChunk, setScrollChunk] = useState(0);

  const measured = viewportWidth > 0;
  const laneWidth = Math.max(1, viewportWidth * zoom - GUTTER * 2);
  const pxPerSecond = laneWidth / duration;

  /** The scroll position as of the last scroll event. */
  const scrolled = useRef(0);
  /** The last position this component scrolled to itself. */
  const ownScroll = useRef(0);
  const userScrolledAt = useRef(0);
  const scrubbing = useRef<number | null>(null);
  /** The point a zoom keeps still: a share of the clip at a viewport offset. */
  const zoomAnchor = useRef<{ fraction: number; offset: number } | null>(null);
  const previousLane = useRef<number | null>(null);

  useLayoutEffect(() => {
    const viewport = scroller.current;
    if (!viewport) return;
    // Measured once by hand: observers stay silent while the tab is hidden.
    setViewportWidth(viewport.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportWidth(entry.contentRect.width);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // Zooming keeps one point of the clip where it is on screen: the pointer for
  // the wheel, otherwise the playhead when it is in view, otherwise the middle.
  useLayoutEffect(() => {
    const viewport = scroller.current;
    const before = previousLane.current;
    previousLane.current = measured ? laneWidth : null;
    if (!viewport || !measured || before === null || before === laneWidth)
      return;
    const anchor = zoomAnchor.current;
    zoomAnchor.current = null;
    let offset = anchor?.offset ?? viewportWidth / 2;
    let fraction = anchor?.fraction;
    if (fraction === undefined) {
      const playheadOffset =
        GUTTER + (getTime() / duration) * before - scrolled.current;
      if (playheadOffset >= 0 && playheadOffset <= viewportWidth)
        offset = playheadOffset;
      fraction = (scrolled.current + offset - GUTTER) / before;
    }
    viewport.scrollLeft = GUTTER + fraction * laneWidth - offset;
    ownScroll.current = viewport.scrollLeft;
    scrolled.current = viewport.scrollLeft;
    setScrollChunk(Math.floor(viewport.scrollLeft / SCROLL_CHUNK));
  }, [duration, getTime, laneWidth, measured, viewportWidth]);

  // React attaches wheel listeners as passive, which cannot stop the browser
  // from zooming the page on Ctrl+wheel.
  useEffect(() => {
    const viewport = scroller.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const next = clampZoom(
          zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE),
          maxZoom,
        );
        if (next === zoom) return;
        const offset = event.clientX - viewport.getBoundingClientRect().left;
        zoomAnchor.current = {
          offset,
          fraction: (viewport.scrollLeft + offset - GUTTER) / laneWidth,
        };
        setPreview({ timelineZoom: next });
      } else if (
        viewport.scrollWidth > viewport.clientWidth &&
        Math.abs(event.deltaY) > Math.abs(event.deltaX)
      ) {
        // The tracks only scroll sideways, so a plain wheel does that.
        event.preventDefault();
        viewport.scrollLeft += event.deltaY;
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [laneWidth, setPreview, zoom]);

  // The playhead moves without rendering: once per frame while playing.
  useEffect(() => {
    const line = playhead.current;
    const viewport = scroller.current;
    if (!line || !viewport || !measured) return;
    const place = () => {
      const time = Math.min(duration, Math.max(0, getTime()));
      const x = Math.round((time / duration) * laneWidth);
      line.style.transform = `translateX(${x}px)`;
      ruler.current?.setAttribute("aria-valuenow", time.toFixed(2));
      ruler.current?.setAttribute("aria-valuetext", formatPreciseTime(time));
      return GUTTER + x;
    };
    const follow = () => {
      const x = place();
      if (zoom <= 1 || scrubbing.current !== null) return;
      const left = scrolled.current;
      let target: number | null = null;
      if (playing) {
        if (performance.now() - userScrolledAt.current < FOLLOW_PAUSE_MS)
          return;
        // Turn the page shortly before the playhead reaches the right edge.
        if (x < left || x > left + viewportWidth - 48)
          target = x - viewportWidth * 0.1;
      } else if (x < left || x > left + viewportWidth) {
        target = x - viewportWidth / 2;
      }
      if (target === null) return;
      viewport.scrollLeft = target;
      ownScroll.current = viewport.scrollLeft;
      scrolled.current = viewport.scrollLeft;
    };
    place();
    return subscribeTime(follow);
  }, [
    duration,
    getTime,
    laneWidth,
    measured,
    playing,
    subscribeTime,
    viewportWidth,
    zoom,
  ]);

  const timeAt = (clientX: number) => {
    const viewport = scroller.current;
    if (!viewport) return 0;
    const x =
      clientX -
      viewport.getBoundingClientRect().left +
      viewport.scrollLeft -
      GUTTER;
    return Math.min(1, Math.max(0, x / laneWidth)) * duration;
  };
  const beginScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Words, their grips and the rename field handle their own pointer.
    if (
      event.target instanceof Element &&
      event.target.closest("[data-timeline-item]")
    )
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubbing.current = event.pointerId;
    seek(timeAt(event.clientX));
  };
  const moveScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubbing.current === event.pointerId) seek(timeAt(event.clientX));
  };
  const endScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubbing.current === event.pointerId) scrubbing.current = null;
  };
  const onRulerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 1 : 1 / fps;
    let next: number;
    if (event.key === "ArrowLeft") next = getTime() - step;
    else if (event.key === "ArrowRight") next = getTime() + step;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = duration;
    else return;
    event.preventDefault();
    seek(Math.min(duration, Math.max(0, next)));
  };

  const fromPx = scrollChunk * SCROLL_CHUNK - OVERSCAN;
  const toPx =
    scrollChunk * SCROLL_CHUNK + SCROLL_CHUNK + viewportWidth + OVERSCAN;
  const fromTime = Math.max(0, (fromPx - GUTTER) / pxPerSecond);
  const toTime = Math.min(duration, (toPx - GUTTER) / pxPerSecond);

  const showWaveform =
    preview.showWaveform &&
    (waveform.status === "ready" || waveform.status === "loading");

  return (
    <div
      ref={scroller}
      data-timeline-scroller
      className="relative z-0 min-h-0 flex-1 overflow-x-auto overflow-y-hidden bg-[#0c0c0f] [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]"
      onScroll={(event) => {
        const left = event.currentTarget.scrollLeft;
        if (Math.abs(left - ownScroll.current) > 1)
          userScrolledAt.current = performance.now();
        scrolled.current = left;
        setScrollChunk(Math.floor(left / SCROLL_CHUNK));
      }}
    >
      <div
        data-timeline-content
        className="relative flex h-full flex-col"
        style={{ width: `${zoom * 100}%` }}
      >
        <div
          ref={ruler}
          role="slider"
          tabIndex={0}
          aria-label="Playhead"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={Number(duration.toFixed(2))}
          data-timeline-ruler
          className="h-6 shrink-0 cursor-col-resize touch-none overflow-hidden border-b border-white/[0.07] bg-[#111114] outline-none focus-visible:bg-lime-300/[0.07] focus-visible:shadow-[inset_0_0_0_1px_rgba(190,242,100,0.55)]"
          onPointerDown={beginScrub}
          onPointerMove={moveScrub}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          onKeyDown={onRulerKeyDown}
        >
          {measured ? (
            <Ruler
              duration={duration}
              pxPerSecond={pxPerSecond}
              fromTime={fromTime}
              toTime={toTime}
            />
          ) : null}
        </div>
        <div
          className="flex min-h-0 flex-1 flex-col"
          onPointerDown={beginScrub}
          onPointerMove={moveScrub}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
        >
          <div
            data-timeline-words
            className={cn(
              "min-h-0 flex-[3] overflow-hidden py-1.5",
              // Past this the extra height reads better as waveform.
              showWaveform && "max-h-36",
            )}
          >
            {measured ? (
              <WordsTrack
                fromTime={fromTime}
                toTime={toTime}
                pxPerSecond={pxPerSecond}
              />
            ) : null}
          </div>
          {showWaveform ? (
            <div className="min-h-0 flex-[2] border-t border-white/[0.05]">
              {waveform.status === "ready" ? (
                <WaveformTrack
                  peaks={waveform.peaks}
                  scroller={scroller}
                  viewportWidth={viewportWidth}
                  laneWidth={laneWidth}
                />
              ) : (
                <p
                  className="sticky left-0 flex h-full items-center justify-center text-[11px] text-zinc-600"
                  style={{ width: viewportWidth }}
                >
                  Loading the waveform…
                </p>
              )}
            </div>
          ) : null}
        </div>
        <div
          ref={playhead}
          data-timeline-playhead
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-3 z-30 w-px bg-lime-300 will-change-transform"
        >
          <span className="absolute -left-1 top-0 h-2 w-[9px] rounded-b-[3px] bg-lime-300" />
        </div>
      </div>
    </div>
  );
}

/** The transport, the word blocks and the waveform under the canvas. */
export function Timeline() {
  const { ready, preview, setPreview } = useStudio();
  const root = useRef<HTMLDivElement>(null);
  const [columnHeight, setColumnHeight] = useState<number | null>(null);
  /** The height while the handle is being dragged; saved when it is let go. */
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{
    pointerY: number;
    startHeight: number;
    height: number;
  } | null>(null);

  useLayoutEffect(() => {
    const column = root.current?.parentElement;
    if (!column) return;
    setColumnHeight(column.clientHeight);
    const observer = new ResizeObserver(() =>
      setColumnHeight(column.clientHeight),
    );
    observer.observe(column);
    return () => observer.disconnect();
  }, []);

  const maxHeight =
    columnHeight === null
      ? TIMELINE_HEIGHT.max
      : Math.max(
          TIMELINE_HEIGHT.min,
          Math.min(TIMELINE_HEIGHT.max, columnHeight - CANVAS_RESERVE),
        );
  const clampHeight = (value: number) =>
    Math.round(Math.min(maxHeight, Math.max(TIMELINE_HEIGHT.min, value)));
  const height = clampHeight(dragHeight ?? preview.timelineHeight);
  const dragging = dragHeight !== null;

  useEffect(() => {
    if (!dragging) return;
    const { userSelect, cursor } = document.body.style;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
    return () => {
      document.body.style.userSelect = userSelect;
      document.body.style.cursor = cursor;
    };
  }, [dragging]);

  const endDrag = () => {
    const finished = drag.current;
    if (!finished) return;
    drag.current = null;
    setDragHeight(null);
    if (finished.height !== finished.startHeight)
      setPreview({ timelineHeight: finished.height });
  };

  return (
    <div
      ref={root}
      data-timeline
      className="relative flex shrink-0 select-none flex-col border-t border-white/[0.07] bg-[#111114]"
      style={{ height }}
    >
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label="Resize timeline"
        aria-valuenow={height}
        aria-valuemin={TIMELINE_HEIGHT.min}
        aria-valuemax={maxHeight}
        title="Drag to resize · double-click to reset"
        data-dragging={dragging ? "" : undefined}
        className="group absolute inset-x-0 -top-1 z-40 flex h-2 cursor-row-resize touch-none items-center justify-center outline-none"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointerY: event.clientY,
            startHeight: height,
            height,
          };
          setDragHeight(height);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current) return;
          // Up is a smaller clientY and a taller timeline.
          const next = clampHeight(
            current.startHeight + current.pointerY - event.clientY,
          );
          if (next === current.height) return;
          current.height = next;
          setDragHeight(next);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={() =>
          setPreview({ timelineHeight: clampHeight(TIMELINE_HEIGHT.initial) })
        }
        onKeyDown={(event) => {
          let next: number;
          const step = event.shiftKey ? 64 : 16;
          if (event.key === "ArrowUp") next = height + step;
          else if (event.key === "ArrowDown") next = height - step;
          else if (event.key === "Home") next = TIMELINE_HEIGHT.min;
          else if (event.key === "End") next = maxHeight;
          else return;
          event.preventDefault();
          setPreview({ timelineHeight: clampHeight(next) });
        }}
      >
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-lime-300/0 transition group-hover:bg-lime-300/40 group-focus-visible:bg-lime-300/60 group-data-[dragging]:bg-lime-300/70" />
        <span className="relative h-1 w-10 rounded-full bg-zinc-600 transition group-hover:bg-lime-300 group-focus-visible:bg-lime-300 group-data-[dragging]:w-14 group-data-[dragging]:bg-lime-300" />
      </div>
      <TransportBar />
      {ready ? (
        <Tracks />
      ) : (
        <p className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs text-zinc-600">
          The transcript appears here.
        </p>
      )}
    </div>
  );
}

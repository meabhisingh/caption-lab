"use client";

import { WORD_LIMITS, cleanWordText } from "@caption-generator/captions";
import type { CaptionWord } from "@caption-generator/types";
import {
  Captions,
  Merge,
  Minus,
  Plus,
  RotateCcw,
  Scissors,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  deleteWord,
  insertWordAfter,
  mergeWithNext,
  retimeWord,
  setWordText,
  splitWord,
} from "@/lib/word-edits";
import {
  EDITOR_UNDO_ATTRIBUTE,
  useActiveWordIndex,
  useIsWordActive,
  usePlayback,
  useStudio,
} from "../studio-context";
import {
  EmptyState,
  IconButton,
  PanelHeader,
  Section,
  cn,
  formatPreciseTime,
} from "../ui";

const NEW_WORD_TEXT = "word";
const NUDGE_SECONDS = 0.05;
const STEP_SECONDS = 0.01;
const CONFIRM_MS = 5000;
// Used to reserve room for the lines that are off screen and not laid out.
const ROW_HEIGHT = 32;
const LINE_CHROME_HEIGHT = 34;

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lime-300/70";

const rowId = (index: number) => `edit-word-${index}`;
const textInputId = (index: number) => `edit-word-text-${index}`;

// A line carries its own few words rather than the whole transcript. React
// compares the props of every line on each edit (and lists what changed in
// development), which is far too slow when each line holds all the words.
type Line = {
  /** Counted from 1. */
  number: number;
  /** Index of the first and of the last word on the line. */
  first: number;
  last: number;
  start: number;
  end: number;
  /** The words of the line that are listed; all of them unless filtering. */
  items: Array<{ index: number; text: string; start: number }>;
};

/**
 * Pages the words the way the renderer does and keeps the ones that contain
 * `needle`. The word at `keep` is listed even when it does not match, so the
 * word being edited never disappears from under the cursor.
 */
const buildLines = (
  words: CaptionWord[],
  pageSize: number,
  needle: string,
  keep: number | null,
) => {
  const lines: Line[] = [];
  let matches = 0;
  for (let first = 0; first < words.length; first += pageSize) {
    const last = Math.min(words.length, first + pageSize) - 1;
    const items: Line["items"] = [];
    for (let index = first; index <= last; index += 1) {
      const word = words[index];
      if (!word) continue;
      const hit = !needle || word.text.toLowerCase().includes(needle);
      if (hit && needle) matches += 1;
      if (hit || index === keep)
        items.push({ index, text: word.text, start: word.start });
    }
    const opening = words[first];
    const closing = words[last];
    if (items.length > 0 && opening && closing)
      lines.push({
        number: first / pageSize + 1,
        first,
        last,
        start: opening.start,
        end: closing.end,
        items,
      });
  }
  return { lines, matches };
};

const sameWord = (a: CaptionWord | undefined, b: CaptionWord | undefined) =>
  a !== undefined &&
  b !== undefined &&
  a.text === b.text &&
  a.start === b.start &&
  a.end === b.end;

const scrollParent = (element: HTMLElement) => {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
};

/** Moves the caret to the next listed word. */
const focusNextWordInput = (input: HTMLInputElement, index: number) => {
  let next = document.getElementById(textInputId(index + 1));
  if (!next) {
    // While filtering the next listed word is not the next index.
    const listed = Array.from(
      input
        .closest("[data-word-list]")
        ?.querySelectorAll<HTMLInputElement>("input[data-word-text]") ?? [],
    );
    next = listed[listed.indexOf(input) + 1] ?? null;
  }
  if (!(next instanceof HTMLInputElement)) return;
  // The panel scrolls the whole row into view once its details are open; the
  // browser's own jump to the field would only make the list bounce.
  next.focus({ preventScroll: true });
  next.select();
};

/** Asks the panel to put the caret in a word once the list has re-rendered. */
const FocusRequestContext = createContext<
  (index: number, selectText: boolean) => void
>(() => undefined);

function RestoreButton({
  disabled,
  onRestore,
}: {
  disabled: boolean;
  onRestore: () => Promise<void>;
}) {
  const [phase, setPhase] = useState<"idle" | "confirm" | "busy">("idle");
  // When the armed button goes back to normal. Kept as a point in time: the
  // effect below is torn down while the tab is hidden and must not start a
  // fresh countdown when it is shown again.
  const [deadline, setDeadline] = useState(0);
  const confirming = phase === "confirm" && !disabled;
  const busy = phase === "busy";

  useEffect(() => {
    if (phase !== "confirm") return;
    const timer = window.setTimeout(
      () => setPhase("idle"),
      Math.max(0, deadline - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [deadline, phase]);

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        disabled={disabled || busy}
        aria-label={
          confirming
            ? "Confirm: replace every edit with the original transcript"
            : "Restore the original transcript"
        }
        title={
          confirming
            ? "Click again to replace every edit with the original transcript"
            : "Bring back the words as they were transcribed"
        }
        onClick={() => {
          if (!confirming) {
            setDeadline(Date.now() + CONFIRM_MS);
            setPhase("confirm");
            return;
          }
          setPhase("busy");
          void onRestore().finally(() => setPhase("idle"));
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && confirming) setPhase("idle");
        }}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition disabled:cursor-default disabled:opacity-30",
          FOCUS_RING,
          confirming
            ? "border-lime-300/40 bg-lime-300/10 text-lime-300"
            : "border-white/10 text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
        )}
      >
        <RotateCcw size={12} />
        {busy ? "Restoring…" : confirming ? "Restore?" : "Restore original"}
      </button>
      {confirming ? (
        <IconButton label="Keep my edits" onClick={() => setPhase("idle")}>
          <X size={13} />
        </IconButton>
      ) : null}
    </div>
  );
}

function FindField({
  query,
  matches,
  onChange,
}: {
  query: string;
  /** Null while there is nothing to search for. */
  matches: number | null;
  onChange: (query: string) => void;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-5 -mt-2 bg-[#111114] px-5 pb-3 pt-2">
      <div className="flex h-9 items-center gap-2 rounded-lg border border-white/10 pl-2.5 pr-1 focus-within:border-lime-300/50">
        <Search size={14} className="shrink-0 text-zinc-600" aria-hidden />
        <input
          type="text"
          role="searchbox"
          aria-label="Find a word"
          placeholder="Find a word"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) onChange("");
          }}
          className="h-full w-full min-w-0 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
        />
        <span
          aria-live="polite"
          className="shrink-0 whitespace-nowrap font-mono text-[10px] text-zinc-500"
        >
          {matches === null
            ? ""
            : `${matches} ${matches === 1 ? "match" : "matches"}`}
        </span>
        {query ? (
          <IconButton label="Clear search" onClick={() => onChange("")}>
            <X size={13} />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Keeps the word being spoken in view while the clip plays, so a mistake can
 * be found by ear. It stands back while the pointer is over the list or a
 * word is being typed.
 */
function FollowPlayback() {
  const { playing } = usePlayback();
  const active = useActiveWordIndex();
  useEffect(() => {
    if (!playing) return;
    const row = document.getElementById(rowId(active));
    const panel = row?.closest("[role=tabpanel]");
    if (!row || !panel || panel.matches(":hover")) return;
    if (panel.contains(document.activeElement)) return;
    row.scrollIntoView({ block: "nearest" });
  }, [active, playing]);
  return null;
}

function TimeField({
  label,
  value,
  max,
  disabled,
  onSet,
  onNudge,
}: {
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  onSet: (seconds: number) => void;
  onNudge: (delta: number) => void;
}) {
  // What is being typed; the committed time is clamped and may differ.
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();
  const nudge =
    "grid h-full w-7 shrink-0 place-items-center rounded-md text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-zinc-500";
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-500"
      >
        {label} <span className="normal-case text-zinc-600">(s)</span>
      </label>
      <div
        className={cn(
          "flex h-8 items-center rounded-lg border border-white/10 bg-black/25 focus-within:border-lime-300/50",
          disabled && "opacity-40",
        )}
      >
        <button
          type="button"
          disabled={disabled}
          aria-label={`${label} ${NUDGE_SECONDS} seconds earlier`}
          title={`-${NUDGE_SECONDS} s`}
          onClick={() => onNudge(-NUDGE_SECONDS)}
          className={cn(nudge, FOCUS_RING)}
        >
          <Minus size={12} />
        </button>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          max={max}
          step={STEP_SECONDS}
          disabled={disabled}
          value={draft ?? value.toFixed(2)}
          {...(draft === null ? { [EDITOR_UNDO_ATTRIBUTE]: "" } : {})}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            const seconds = Number(raw);
            if (raw.trim() !== "" && Number.isFinite(seconds)) onSet(seconds);
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(event) => {
            if (event.key === "Enter") setDraft(null);
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            // Stepped here so the field shows the time that was really applied.
            event.preventDefault();
            setDraft(null);
            onNudge(event.key === "ArrowUp" ? STEP_SECONDS : -STEP_SECONDS);
          }}
          // A focused number field would otherwise change while scrolling.
          onWheel={(event) => event.currentTarget.blur()}
          className="h-full w-full min-w-0 bg-transparent text-center font-mono text-[11px] text-zinc-200 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          disabled={disabled}
          aria-label={`${label} ${NUDGE_SECONDS} seconds later`}
          title={`+${NUDGE_SECONDS} s`}
          onClick={() => onNudge(NUDGE_SECONDS)}
          className={cn(nudge, FOCUS_RING)}
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}

function ActionButton({
  label,
  title,
  disabled,
  onClick,
  children,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md border border-white/10 px-2 text-[11px] font-medium text-zinc-300 transition hover:bg-white/5 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-300",
        FOCUS_RING,
      )}
    >
      {children}
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * Timing and structure controls of the selected word. Only one exists at a
 * time, so it can read the document directly without slowing the list down.
 */
function WordDetails({ index }: { index: number }) {
  const { words, duration, fps, locked, setWords, selectWord } = useStudio();
  const { seek } = usePlayback();
  const requestFocus = useContext(FocusRequestContext);
  const word = words[index];
  if (!word) return null;

  const retime = (
    change: (current: CaptionWord) => { start?: number; end?: number },
    coalesceKey: string,
  ) =>
    setWords((current) => {
      const before = current[index];
      if (!before) return current;
      const next = retimeWord(current, index, change(before), duration);
      const after = next[index];
      // A time that was clamped back to where it was is not an edit.
      return after && after.start === before.start && after.end === before.end
        ? current
        : next;
    }, coalesceKey);

  const startKey = `edit-word-start-${index}`;
  const endKey = `edit-word-end-${index}`;
  const isLast = index === words.length - 1;

  const addAfter = () => {
    const next = insertWordAfter(words, index, NEW_WORD_TEXT, duration);
    if (next === words) return;
    // Words are kept in order of their start, so when this word overlaps the
    // ones after it the new word lands further down than the next row.
    let added = index + 1;
    while (added < words.length && sameWord(words[added], next[added]))
      added += 1;
    setWords((current) =>
      current === words
        ? next
        : insertWordAfter(current, index, NEW_WORD_TEXT, duration),
    );
    selectWord(added);
    requestFocus(added, true);
  };

  const remove = () => {
    const neighbour = isLast ? words[index - 1] : words[index + 1];
    setWords((current) => deleteWord(current, index, duration));
    selectWord(isLast ? index - 1 : index);
    // The first frame at or after its start, so it shows as the active word.
    if (neighbour) seek(Math.ceil(neighbour.start * fps) / fps);
    if (isLast) requestFocus(index - 1, false);
  };

  return (
    <div
      role="group"
      aria-label={`Timing and actions for word ${index + 1}`}
      className="space-y-2 px-2 pb-2 pt-1"
    >
      <div className="grid grid-cols-2 gap-2">
        <TimeField
          label="Start"
          value={word.start}
          max={duration}
          disabled={locked}
          onSet={(start) => retime(() => ({ start }), startKey)}
          onNudge={(delta) =>
            retime((current) => ({ start: current.start + delta }), startKey)
          }
        />
        <TimeField
          label="End"
          value={word.end}
          max={duration}
          disabled={locked}
          onSet={(end) => retime(() => ({ end }), endKey)}
          onNudge={(delta) =>
            retime((current) => ({ end: current.end + delta }), endKey)
          }
        />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <ActionButton
          label="Split"
          title="Split this word in two"
          disabled={locked || word.text.length < 2}
          onClick={() =>
            setWords((current) => splitWord(current, index, duration))
          }
        >
          <Scissors size={12} className="shrink-0" />
        </ActionButton>
        <ActionButton
          label="Merge with next"
          title="Join this word and the next into one highlighted unit"
          disabled={locked || isLast}
          onClick={() =>
            setWords((current) => mergeWithNext(current, index, duration))
          }
        >
          <Merge size={12} className="shrink-0" />
        </ActionButton>
        <ActionButton
          label="Add word after"
          title="Insert a new word after this one"
          disabled={locked || words.length >= WORD_LIMITS.count}
          onClick={addAfter}
        >
          <Plus size={12} className="shrink-0" />
        </ActionButton>
        <ActionButton
          label="Delete"
          title={
            words.length <= 1
              ? "The last word cannot be deleted"
              : "Delete this word"
          }
          disabled={locked || words.length <= 1}
          onClick={remove}
        >
          <Trash2 size={12} className="shrink-0" />
        </ActionButton>
      </div>
    </div>
  );
}

type RowHandlers = {
  onSelect: (index: number) => void;
  onCommitText: (index: number, text: string) => void;
};

const WordRow = memo(function WordRow({
  index,
  text,
  start,
  selected,
  disabled,
  onSelect,
  onCommitText,
}: RowHandlers & {
  index: number;
  text: string;
  start: number;
  selected: boolean;
  disabled: boolean;
}) {
  const active = useIsWordActive(index);
  const [draft, setDraft] = useState<string | null>(null);
  const finish = (value: string) => {
    onCommitText(index, value);
    setDraft(null);
  };
  return (
    <li
      id={rowId(index)}
      data-selected={selected || undefined}
      data-active={active || undefined}
      aria-current={active ? "true" : undefined}
      className={cn(
        "relative scroll-mb-2 scroll-mt-16 rounded-lg",
        selected
          ? "bg-lime-300/[0.07] ring-1 ring-inset ring-lime-300/30"
          : "hover:bg-white/[0.03]",
      )}
    >
      {active ? (
        <span
          aria-hidden
          className="absolute left-0.5 top-2 h-4 w-0.5 rounded-full bg-lime-300"
        />
      ) : null}
      <div
        className="flex h-8 items-center gap-1 pl-2.5 pr-1"
        onClick={() => onSelect(index)}
      >
        <button
          type="button"
          // The text field already selects on focus; this is the way in while
          // the fields are disabled.
          tabIndex={disabled ? 0 : -1}
          aria-label={`Go to word ${index + 1} at ${formatPreciseTime(start)}`}
          title="Go to this word"
          className={cn(
            "h-6 w-[52px] shrink-0 rounded text-left font-mono text-[10px] tabular-nums transition",
            FOCUS_RING,
            active ? "text-lime-300" : "text-zinc-600 hover:text-zinc-300",
          )}
        >
          {formatPreciseTime(start)}
        </button>
        <input
          id={textInputId(index)}
          data-word-text
          type="text"
          aria-label={`Word ${index + 1}`}
          autoComplete="off"
          spellCheck={false}
          maxLength={WORD_LIMITS.textLength}
          disabled={disabled}
          value={disabled ? text : (draft ?? text)}
          // With nothing typed over the word, Ctrl+Z is the editor's undo.
          {...(draft === null || draft === text
            ? { [EDITOR_UNDO_ATTRIBUTE]: "" }
            : {})}
          onFocus={() => onSelect(index)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => finish(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              finish(event.currentTarget.value);
              focusNextWordInput(event.currentTarget, index);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(null);
            }
          }}
          className={cn(
            // A disabled field swallows clicks; letting them through to the row
            // keeps a word selectable while an export locks the text.
            "h-7 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-xs outline-none transition-colors hover:border-white/10 focus:border-lime-300/50 focus:bg-black/30 disabled:pointer-events-none disabled:opacity-50",
            active ? "text-lime-200" : "text-zinc-200",
          )}
        />
      </div>
      {selected ? <WordDetails index={index} /> : null}
    </li>
  );
});

const LineGroup = memo(function LineGroup({
  line,
  selectedIndex,
  disabled,
  onSeek,
  onSelect,
  onCommitText,
}: RowHandlers & {
  line: Line;
  /** The selected word when it is on this line, otherwise -1. */
  selectedIndex: number;
  disabled: boolean;
  onSeek: (start: number) => void;
}) {
  const from = formatPreciseTime(line.start);
  const to = formatPreciseTime(line.end);
  return (
    <li
      className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.015] [content-visibility:auto]"
      style={{
        containIntrinsicBlockSize: `auto ${LINE_CHROME_HEIGHT + line.items.length * ROW_HEIGHT}px`,
      }}
    >
      <button
        type="button"
        onClick={() => onSeek(line.start)}
        aria-label={`Line ${line.number}, ${from} to ${to}. Go to this line`}
        title="Go to this line"
        className={cn(
          "flex h-7 w-full items-center justify-between gap-2 px-3 text-[10px] text-zinc-500 transition hover:bg-white/[0.03] hover:text-zinc-300",
          FOCUS_RING,
        )}
      >
        <span className="font-semibold uppercase tracking-wider">
          Line {line.number}
        </span>
        <span className="font-mono tabular-nums text-zinc-600">
          {`${from} – ${to}`}
        </span>
      </button>
      <ul aria-label={`Words on line ${line.number}`} className="px-1 pb-1">
        {line.items.map((item) => (
          <WordRow
            key={item.index}
            index={item.index}
            text={item.text}
            start={item.start}
            selected={item.index === selectedIndex}
            disabled={disabled}
            onSelect={onSelect}
            onCommitText={onCommitText}
          />
        ))}
      </ul>
    </li>
  );
});

/** The "Edit" tab: the transcript, one editable row per word. */
export function EditPanel() {
  const {
    ready,
    locked,
    words,
    style,
    duration,
    fps,
    selectedWordIndex,
    selectWord,
    setWords,
    resetWords,
  } = useStudio();
  const { seek } = usePlayback();

  const [query, setQuery] = useState("");
  const needle = useDeferredValue(query).trim().toLowerCase();
  const pageSize = Math.max(1, style.maxWords);
  const kept = needle ? selectedWordIndex : null;
  const { lines, matches } = useMemo(
    () => buildLines(words, pageSize, needle, kept),
    [words, pageSize, needle, kept],
  );

  // `seek` gets a new identity whenever playback starts or stops; going
  // through a ref keeps that from re-rendering every line.
  const seekRef = useRef(seek);
  useEffect(() => {
    seekRef.current = seek;
  }, [seek]);
  const seekToStart = useCallback(
    (start: number) => seekRef.current(Math.ceil(start * fps) / fps),
    [fps],
  );

  const commitText = useCallback(
    (index: number, text: string) => {
      const cleaned = cleanWordText(text);
      if (!cleaned) return;
      setWords((current) =>
        current[index]?.text === cleaned
          ? current
          : setWordText(current, index, cleaned, duration),
      );
    },
    [duration, setWords],
  );

  // Selecting a word collapses the details of the previous one, which would
  // slide the list under the pointer, so a row picked with the pointer keeps
  // its place on screen. A row reached from the keyboard has no pointer to
  // stay under and is scrolled fully into view instead.
  const pointerInput = useRef(false);
  useEffect(() => {
    const onPointerDown = () => {
      pointerInput.current = true;
    };
    const onKeyDown = () => {
      pointerInput.current = false;
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);
  const anchor = useRef<{ index: number; top: number } | null>(null);
  const select = useCallback(
    (index: number) => {
      const row = pointerInput.current
        ? document.getElementById(rowId(index))
        : null;
      anchor.current = row
        ? { index, top: row.getBoundingClientRect().top }
        : null;
      selectWord(index, { seek: true });
    },
    [selectWord],
  );
  const handledSelection = useRef<number | null>(null);
  useLayoutEffect(() => {
    const held = anchor.current;
    anchor.current = null;
    const repeated = handledSelection.current === selectedWordIndex;
    handledSelection.current = selectedWordIndex;
    if (selectedWordIndex === null) return;
    // Shown again after a visit to another tab: the selection is not new, so
    // the list stays where it was scrolled.
    if (repeated && !held) return;
    const row = document.getElementById(rowId(selectedWordIndex));
    if (!row) return;
    if (held?.index === selectedWordIndex) {
      const scroller = scrollParent(row);
      if (scroller)
        scroller.scrollTop += row.getBoundingClientRect().top - held.top;
    } else {
      // Selected elsewhere, such as by a click in the timeline: follow it.
      row.scrollIntoView({ block: "nearest" });
    }
  }, [selectedWordIndex]);

  // Clearing the search brings every word back, which would push the word
  // being worked on out of view.
  const shownNeedle = useRef(needle);
  useLayoutEffect(() => {
    const cleared = shownNeedle.current !== "" && needle === "";
    shownNeedle.current = needle;
    if (cleared && selectedWordIndex !== null)
      document
        .getElementById(rowId(selectedWordIndex))
        ?.scrollIntoView({ block: "nearest" });
  }, [needle, selectedWordIndex]);

  const pendingFocus = useRef<{ index: number; selectText: boolean } | null>(
    null,
  );
  const requestFocus = useCallback((index: number, selectText: boolean) => {
    pendingFocus.current = { index, selectText };
  }, []);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    // Focusing selects and seeks to the word, which reads the provider's copy
    // of the words; that copy is refreshed by an effect that runs after this
    // one, so wait until all of them have run.
    queueMicrotask(() => {
      const input = document.getElementById(textInputId(pending.index));
      if (!(input instanceof HTMLInputElement)) return;
      input.focus();
      if (pending.selectText) input.select();
    });
  }, [words, selectedWordIndex]);

  return (
    <>
      <PanelHeader
        title="Edit captions"
        description="Fix a word, its timing, or how words are grouped."
        action={
          <RestoreButton disabled={locked || !ready} onRestore={resetWords} />
        }
      />
      {ready ? (
        <Section
          title="Transcript"
          action={
            <span className="font-mono text-[11px] text-zinc-600">
              {words.length} {words.length === 1 ? "word" : "words"}
            </span>
          }
        >
          <div>
            <FollowPlayback />
            <FindField
              query={query}
              matches={needle ? matches : null}
              onChange={setQuery}
            />
            {needle && matches === 0 ? (
              <p className="break-words py-6 text-center text-xs leading-5 text-zinc-600">
                No word contains “{query.trim()}”.
              </p>
            ) : null}
            {lines.length === 0 ? null : (
              <FocusRequestContext value={requestFocus}>
                <ol
                  data-word-list
                  aria-label="Caption lines"
                  className="space-y-2"
                >
                  {lines.map((line) => (
                    <LineGroup
                      key={line.number}
                      line={line}
                      selectedIndex={
                        selectedWordIndex !== null &&
                        selectedWordIndex >= line.first &&
                        selectedWordIndex <= line.last
                          ? selectedWordIndex
                          : -1
                      }
                      disabled={locked}
                      onSeek={seekToStart}
                      onSelect={select}
                      onCommitText={commitText}
                    />
                  ))}
                </ol>
              </FocusRequestContext>
            )}
          </div>
        </Section>
      ) : (
        <EmptyState
          icon={<Captions size={20} />}
          title="No transcript yet"
          description="The transcript appears here once it has been transcribed."
        />
      )}
    </>
  );
}

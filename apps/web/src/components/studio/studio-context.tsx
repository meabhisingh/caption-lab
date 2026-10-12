"use client";

import {
  CAPTION_TEMPLATES,
  findActiveWordIndex,
  normalizeCaptionStyle,
  sameCaptionStyle,
  sanitizeWords,
} from "@caption-generator/captions";
import type {
  CaptionProject,
  CaptionStyle,
  CaptionTemplateId,
  CaptionWord,
} from "@caption-generator/types";
import type { PlayerRef } from "@remotion/player";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  exportProject,
  resetProjectWords,
  saveProjectStyle,
  saveProjectWords,
} from "@/lib/api";
import {
  loadPreviewSettings,
  savePreviewSettings,
  type PreviewSettings,
} from "@/lib/preview-settings";
import { loadWaveformPeaks, type Waveform } from "@/lib/waveform";

// The editor's shared state. Three things live here:
//
//   useStudio()    the document (style and words), its undo history, autosave,
//                  the selection, the open tab and the editor preferences.
//   usePlayback()  the transport of the preview player.
//   useStudioTime(), useActiveWordIndex(), useIsWordActive()
//                  the playhead. These re-render on their own schedule so the
//                  two contexts above never change while the clip plays.

export type StudioTab = "edit" | "text" | "layers" | "audio";
export type SaveState = "saved" | "unsaved" | "saving" | "error";

type Doc = { style: CaptionStyle; words: CaptionWord[] };

type History = {
  past: Doc[];
  present: Doc;
  future: Doc[];
  coalesceKey: string | null;
  coalesceGesture: number | null;
  coalesceAt: number;
};

const fresh = { coalesceKey: null, coalesceGesture: null, coalesceAt: 0 };

const sameWords = (left: CaptionWord[], right: CaptionWord[]) =>
  left.length === right.length &&
  left.every((word, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      word.text === other.text &&
      word.start === other.start &&
      word.end === other.end
    );
  });

type HistoryAction =
  | {
      type: "commit";
      change: (current: Doc) => Doc;
      coalesceKey: string | null;
      /** The pointer press this change belongs to, if any. */
      gesture: number | null;
      at: number;
    }
  | { type: "adopt-words"; words: CaptionWord[] }
  | { type: "undo" }
  | { type: "redo" };

const HISTORY_LIMIT = 100;
// Changes without a pointer press that share a key and arrive this close
// together, such as arrow keys on a slider, become a single undo step.
const COALESCE_MS = 900;
const SAVE_DELAY_MS = 400;

// Changes that share a key become one undo step when they belong to the same
// pointer press (one drag, however slow), or, without a press, when they
// arrive close together.
const coalesces = (
  state: History,
  action: Extract<HistoryAction, { type: "commit" }>,
) => {
  if (action.coalesceKey === null || action.coalesceKey !== state.coalesceKey)
    return false;
  if (action.gesture !== null || state.coalesceGesture !== null)
    return action.gesture === state.coalesceGesture;
  return action.at - state.coalesceAt < COALESCE_MS;
};

const historyReducer = (state: History, action: HistoryAction): History => {
  switch (action.type) {
    case "commit": {
      const next = action.change(state.present);
      // Choosing what is already chosen is not a step to undo.
      if (
        next.words === state.present.words &&
        (next.style === state.present.style ||
          sameCaptionStyle(next.style, state.present.style))
      )
        return state;
      return {
        past: coalesces(state, action)
          ? state.past
          : [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: next,
        future: [],
        coalesceKey: action.coalesceKey,
        coalesceGesture: action.gesture,
        coalesceAt: action.at,
      };
    }
    case "adopt-words": {
      // The transcript arriving is not an edit: every step made while it was
      // being transcribed stays undoable and simply gains the words.
      const withWords = (doc: Doc) => ({ ...doc, words: action.words });
      return {
        past: state.past.map(withWords),
        present: withWords(state.present),
        future: state.future.map(withWords),
        ...fresh,
      };
    }
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
        ...fresh,
      };
    }
    case "redo": {
      const [next, ...future] = state.future;
      if (!next) return state;
      return {
        past: [...state.past, state.present],
        present: next,
        future,
        ...fresh,
      };
    }
  }
};

type Store<T> = {
  get: () => T;
  set: (next: T) => void;
  subscribe: (listener: () => void) => () => void;
};

const createStore = <T,>(initial: T): Store<T> => {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export type StudioContextValue = {
  project: CaptionProject;
  /** Length of the clip in seconds; 0 until the transcript is ready. */
  duration: number;
  fps: number;
  /** The transcript is there and can be previewed and edited. */
  ready: boolean;
  /** An export is rendering; every edit is ignored until it finishes. */
  locked: boolean;

  style: CaptionStyle;
  words: CaptionWord[];
  /** Replaces the whole style. */
  setStyle: (next: CaptionStyle, coalesceKey?: string) => void;
  /**
   * Changes some style fields. Pass a `coalesceKey` naming the control for
   * continuous input (a slider, a color picker, a drag) so the whole gesture
   * becomes one undo step.
   */
  patchStyle: (patch: Partial<CaptionStyle>, coalesceKey?: string) => void;
  /** Replaces the style with a template's. */
  applyTemplate: (id: CaptionTemplateId) => void;
  /** Replaces the words, or derives them from the current ones. */
  setWords: (
    next: CaptionWord[] | ((current: CaptionWord[]) => CaptionWord[]),
    coalesceKey?: string,
  ) => void;
  /** Brings back the words Groq returned. Can be undone. */
  resetWords: () => Promise<void>;
  /** How many times the original transcript has been restored. */
  restoreCount: number;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saveState: SaveState;
  saveError: string | null;
  retrySave: () => void;

  selectedWordIndex: number | null;
  /** Selects a word; with `seek` the playhead also jumps to it. */
  selectWord: (index: number | null, options?: { seek?: boolean }) => void;

  activeTab: StudioTab;
  setActiveTab: (tab: StudioTab) => void;

  /** Editor-only preferences, kept in localStorage. */
  preview: PreviewSettings;
  setPreview: (patch: Partial<PreviewSettings>) => void;

  /** The uploaded file, playable in the browser. */
  mediaSrc: string | null;
  waveform: Waveform;

  /** Saves pending edits, then starts rendering the overlay. */
  exportOverlay: () => Promise<void>;
  /** Desktop only: asks where to save the finished export. */
  saveExport: (() => Promise<void>) | null;
};

export type PlaybackContextValue = {
  playing: boolean;
  /** 0 to 1. */
  volume: number;
  muted: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Moves the playhead to a time in seconds. */
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  /** The playhead in seconds, read once without subscribing. */
  getTime: () => number;
  /** Calls `listener` whenever the playhead moves. Returns an unsubscribe. */
  subscribeTime: (listener: () => void) => () => void;
  /** Ref callback for the Remotion player; used by the preview stage only. */
  attachPlayer: (player: PlayerRef | null) => void;
};

type PlayheadStores = { frame: Store<number>; activeWord: Store<number> };

const StudioContext = createContext<StudioContextValue | null>(null);
const PlaybackContext = createContext<PlaybackContextValue | null>(null);
const PlayheadContext = createContext<PlayheadStores | null>(null);

const useRequired = <T,>(context: React.Context<T | null>, name: string) => {
  const value = useContext(context);
  if (!value) throw new Error(`${name} must be used inside <StudioProvider>.`);
  return value;
};

export const useStudio = () => useRequired(StudioContext, "useStudio");
export const usePlayback = () => useRequired(PlaybackContext, "usePlayback");

/** The playhead in seconds. Re-renders on every frame while playing. */
export const useStudioTime = () => {
  const { getTime, subscribeTime } = usePlayback();
  return useSyncExternalStore(subscribeTime, getTime, () => 0);
};

/** Index of the word highlighted at the playhead. Re-renders when it changes. */
export const useActiveWordIndex = () => {
  const { activeWord } = useRequired(PlayheadContext, "useActiveWordIndex");
  return useSyncExternalStore(activeWord.subscribe, activeWord.get, () => 0);
};

/** Whether one word is highlighted at the playhead; cheap to use per row. */
export const useIsWordActive = (index: number) => {
  const { activeWord } = useRequired(PlayheadContext, "useIsWordActive");
  return useSyncExternalStore(
    activeWord.subscribe,
    () => activeWord.get() === index,
    () => false,
  );
};

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "number",
  "email",
  "url",
  "tel",
  "password",
]);

/** A field text is typed into, which has the browser's own undo. */
const isTextEntry = (target: HTMLElement | null) =>
  target !== null &&
  (target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type)));

/**
 * Set by a text field that shows a value of the document with nothing typed
 * over it. Ctrl+Z there belongs to the editor: the browser's undo would only
 * revert some other field it still remembers.
 */
export const EDITOR_UNDO_ATTRIBUTE = "data-editor-undo";

/** Controls that give the arrow keys a meaning of their own. */
const USES_ARROWS =
  "input, textarea, select, button, a[href], [contenteditable=true], [role=slider], [role=separator], [role=radio], [role=tab], [role=switch], [role=button]";

/** Controls the space bar types into or opens. */
const TYPES_SPACE = "textarea, select, [contenteditable=true]";

/** Controls the space bar presses when they are reached with the keyboard. */
const PRESSED_BY_SPACE =
  "button, a[href], summary, [role=button], [role=tab], [role=radio], [role=switch], [role=checkbox], input[type=checkbox], input[type=radio], input[type=color], input[type=file]";

export function StudioProvider({
  project,
  mediaSrc,
  onProjectChange,
  onError,
  saveExport,
  children,
}: {
  project: CaptionProject;
  mediaSrc: string | null;
  /** Receives every project the API returns for an edit or an export. */
  onProjectChange: (project: CaptionProject) => void;
  onError: (message: string | null) => void;
  saveExport: (() => Promise<void>) | null;
  children: ReactNode;
}) {
  const projectId = project.id;
  const fps = project.fps;
  const duration = project.durationSeconds ?? 0;
  // Locked from the click on Export, not only once the API has answered, so
  // no edit can slip in that the render would not contain.
  const [exportPending, setExportPending] = useState(false);
  const locked = project.status === "EXPORTING" || exportPending;

  const [history, dispatch] = useReducer(
    historyReducer,
    project,
    (initial): History => ({
      past: [],
      present: {
        style: normalizeCaptionStyle(initial.style),
        words: initial.words,
      },
      future: [],
      ...fresh,
    }),
  );
  const { style, words } = history.present;
  const ready = duration > 0 && words.length > 0;

  // ---- Autosave -----------------------------------------------------------
  // The local document is the source of truth while editing. Each change is
  // written after a short pause, one request at a time, and the answer only
  // updates the project record, never the document.

  const saved = useRef<Doc | null>(null);
  if (saved.current === null) saved.current = history.present;
  const latest = useRef<Doc>(history.present);
  const callbacks = useRef({ onProjectChange, onError });
  useEffect(() => {
    latest.current = history.present;
    callbacks.current = { onProjectChange, onError };
  });

  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);

  const runSaves = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      setSaveState("saving");
      try {
        for (;;) {
          const doc = latest.current;
          const done = saved.current ?? doc;
          if (doc.style !== done.style) {
            const next = await saveProjectStyle(projectId, doc.style);
            saved.current = { ...done, style: doc.style };
            callbacks.current.onProjectChange(next);
          } else if (doc.words !== done.words && doc.words.length > 0) {
            const next = await saveProjectWords(projectId, doc.words);
            saved.current = { ...done, words: doc.words };
            callbacks.current.onProjectChange(next);
          } else break;
        }
        setSaveError(null);
        setSaveState("saved");
        return true;
      } catch (error) {
        setSaveError(
          error instanceof Error ? error.message : "Could not save changes",
        );
        setSaveState("error");
        return false;
      }
    })();
    // Cleared only once the run has settled. A run with nothing to save
    // finishes before this line, so clearing inside the function would leave
    // its finished promise here for good and no later edit would be saved.
    inFlight.current = run;
    void run.finally(() => {
      if (inFlight.current === run) inFlight.current = null;
    });
    return run;
  }, [projectId]);

  useEffect(() => {
    const done = saved.current;
    if (!done || (style === done.style && words === done.words)) {
      // Back at what is saved, for example after an undo: nothing is pending.
      if (!inFlight.current) {
        setSaveState("saved");
        setSaveError(null);
      }
      return;
    }
    setSaveState((current) => (current === "saving" ? current : "unsaved"));
    const timer = window.setTimeout(() => void runSaves(), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [runSaves, style, words]);

  // Edits made in the last moment before the editor closes are still written.
  useEffect(() => () => void runSaves(), [runSaves]);

  // Closing or reloading the page cancels ordinary requests, so what is still
  // unsaved goes out as requests the browser finishes on its own.
  useEffect(() => {
    const onPageHide = () => {
      const doc = latest.current;
      const done = saved.current;
      if (!done) return;
      const ignore = () => undefined;
      if (doc.style !== done.style)
        void saveProjectStyle(projectId, doc.style, true).catch(ignore);
      if (doc.words !== done.words && doc.words.length > 0)
        void saveProjectWords(projectId, doc.words, true).catch(ignore);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [projectId]);

  // The words arrive once transcription finishes.
  const serverWords = project.words;
  useEffect(() => {
    if (latest.current.words.length > 0 || serverWords.length === 0) return;
    saved.current = {
      ...(saved.current ?? latest.current),
      words: serverWords,
    };
    dispatch({ type: "adopt-words", words: serverWords });
  }, [serverWords]);

  // ---- Document actions ---------------------------------------------------

  // Which pointer press is under way, so a whole drag is one undo step no
  // matter how slowly it moves. A click's handler runs after the release.
  const press = useRef({ id: 0, down: false });
  // The control that got the focus from a pointer press rather than from the
  // keyboard; the space bar treats the two differently.
  const pointerFocused = useRef<Element | null>(null);
  useEffect(() => {
    const onDown = () => {
      press.current = { id: press.current.id + 1, down: true };
    };
    const onUp = () => {
      press.current = { ...press.current, down: false };
    };
    const onFocus = (event: FocusEvent) => {
      pointerFocused.current =
        press.current.down && event.target instanceof Element
          ? event.target.closest(PRESSED_BY_SPACE)
          : null;
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    window.addEventListener("blur", onUp);
    window.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("blur", onUp);
      window.removeEventListener("focusin", onFocus);
    };
  }, []);

  const commit = useCallback(
    (change: (current: Doc) => Doc, coalesceKey?: string) => {
      if (locked) return;
      dispatch({
        type: "commit",
        change,
        coalesceKey: coalesceKey ?? null,
        gesture: press.current.down ? press.current.id : null,
        at: Date.now(),
      });
    },
    [locked],
  );

  const setStyle = useCallback(
    (next: CaptionStyle, coalesceKey?: string) =>
      commit(
        (current) => ({ ...current, style: normalizeCaptionStyle(next) }),
        coalesceKey,
      ),
    [commit],
  );

  const patchStyle = useCallback(
    (patch: Partial<CaptionStyle>, coalesceKey?: string) =>
      commit(
        (current) => ({
          ...current,
          style: normalizeCaptionStyle({ ...current.style, ...patch }),
        }),
        coalesceKey,
      ),
    [commit],
  );

  const applyTemplate = useCallback(
    (id: CaptionTemplateId) =>
      commit((current) => ({ ...current, style: CAPTION_TEMPLATES[id] })),
    [commit],
  );

  const setWords = useCallback(
    (
      next: CaptionWord[] | ((current: CaptionWord[]) => CaptionWord[]),
      coalesceKey?: string,
    ) =>
      commit((current) => {
        const proposed =
          typeof next === "function" ? next(current.words) : next;
        if (proposed === current.words) return current;
        const cleaned = sanitizeWords(proposed, duration);
        // An edit that changes nothing must not cost an undo step or a save.
        return cleaned.length > 0 && !sameWords(cleaned, current.words)
          ? { ...current, words: cleaned }
          : current;
      }, coalesceKey),
    [commit, duration],
  );

  const [restoreCount, setRestoreCount] = useState(0);
  const resetWords = useCallback(async () => {
    if (locked) return;
    callbacks.current.onError(null);
    try {
      if (!(await runSaves())) return;
      const next = await resetProjectWords(projectId);
      setRestoreCount((count) => count + 1);
      saved.current = {
        ...(saved.current ?? latest.current),
        words: next.words,
      };
      dispatch({
        type: "commit",
        change: (current) => ({ ...current, words: next.words }),
        coalesceKey: null,
        gesture: null,
        at: Date.now(),
      });
      callbacks.current.onProjectChange(next);
    } catch (error) {
      callbacks.current.onError(
        error instanceof Error
          ? error.message
          : "Could not restore the transcript",
      );
    }
  }, [locked, projectId, runSaves]);

  const undo = useCallback(() => {
    if (!locked) dispatch({ type: "undo" });
  }, [locked]);
  const redo = useCallback(() => {
    if (!locked) dispatch({ type: "redo" });
  }, [locked]);

  const exportOverlay = useCallback(async () => {
    callbacks.current.onError(null);
    setExportPending(true);
    try {
      if (!(await runSaves()))
        throw new Error("Save your changes before exporting.");
      callbacks.current.onProjectChange(await exportProject(projectId));
    } catch (error) {
      callbacks.current.onError(
        error instanceof Error ? error.message : "Export failed",
      );
    } finally {
      setExportPending(false);
    }
  }, [projectId, runSaves]);

  // Anything still unsaved when the lock lifts is written then.
  useEffect(() => {
    const done = saved.current;
    const doc = latest.current;
    if (
      !locked &&
      done &&
      (doc.style !== done.style || doc.words !== done.words)
    )
      void runSaves();
  }, [locked, runSaves]);

  // ---- Playback -----------------------------------------------------------

  const [player, attachPlayer] = useState<PlayerRef | null>(null);
  const [stores] = useState<PlayheadStores>(() => ({
    frame: createStore(0),
    activeWord: createStore(0),
  }));
  const [playing, setPlaying] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMutedState] = useState(false);

  useEffect(() => {
    if (!player) return;
    const onFrame = (event: { detail: { frame: number } }) =>
      stores.frame.set(event.detail.frame);
    const onPlay = () => setPlaying(true);
    const onStop = () => setPlaying(false);
    const onVolume = (event: { detail: { volume: number } }) =>
      setVolumeState(event.detail.volume);
    const onMute = (event: { detail: { isMuted: boolean } }) =>
      setMutedState(event.detail.isMuted);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onStop);
    player.addEventListener("ended", onStop);
    player.addEventListener("volumechange", onVolume);
    player.addEventListener("mutechange", onMute);
    stores.frame.set(player.getCurrentFrame());
    setPlaying(player.isPlaying());
    setVolumeState(player.getVolume());
    setMutedState(player.isMuted());
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onStop);
      player.removeEventListener("ended", onStop);
      player.removeEventListener("volumechange", onVolume);
      player.removeEventListener("mutechange", onMute);
      setPlaying(false);
    };
  }, [player, stores]);

  // One lookup per frame, shared by everything that shows the active word.
  useEffect(() => {
    const update = () =>
      stores.activeWord.set(
        findActiveWordIndex(words, stores.frame.get() / fps),
      );
    update();
    return stores.frame.subscribe(update);
  }, [fps, stores, words]);

  const lastFrame = Math.max(0, Math.ceil(duration * fps) - 1);
  const seekToFrame = useCallback(
    (frame: number) => {
      const safe = Math.min(lastFrame, Math.max(0, Math.round(frame)));
      if (player) player.seekTo(safe);
      else stores.frame.set(safe);
    },
    [lastFrame, player, stores],
  );

  const playback = useMemo<PlaybackContextValue>(
    () => ({
      playing,
      volume,
      muted,
      play: () => player?.play(),
      pause: () => player?.pause(),
      toggle: () => player?.toggle(),
      seek: (seconds) => seekToFrame(seconds * fps),
      setVolume: (next) => {
        const safe = Math.min(1, Math.max(0, next));
        player?.setVolume(safe);
        if (safe > 0 && player?.isMuted()) player.unmute();
      },
      setMuted: (next) => (next ? player?.mute() : player?.unmute()),
      getTime: () => stores.frame.get() / fps,
      subscribeTime: stores.frame.subscribe,
      attachPlayer,
    }),
    [fps, muted, player, playing, seekToFrame, stores, volume],
  );

  // ---- Selection, tabs, preferences ---------------------------------------

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selectedWordIndex =
    selectedIndex !== null && selectedIndex < words.length
      ? selectedIndex
      : null;

  // The seek waits for the next render, so a caller that changes the words and
  // selects one in the same handler lands on the word's new position.
  const [seekRequest, setSeekRequest] = useState<{ index: number } | null>(
    null,
  );
  const selectWord = useCallback(
    (index: number | null, options?: { seek?: boolean }) => {
      setSelectedIndex(index);
      if (index !== null && options?.seek) setSeekRequest({ index });
    },
    [],
  );
  // Read through a ref so that only a new request seeks, not a new player.
  const seekTo = useRef(seekToFrame);
  useEffect(() => {
    seekTo.current = seekToFrame;
  });
  useEffect(() => {
    const word = seekRequest ? latest.current.words[seekRequest.index] : null;
    // The first frame at or after the word's start, so it shows as active.
    if (word) seekTo.current(Math.ceil(word.start * fps));
  }, [fps, seekRequest]);

  const [activeTab, setActiveTab] = useState<StudioTab>("text");
  const [preview, setPreviewState] = useState(loadPreviewSettings);
  const setPreview = useCallback(
    (patch: Partial<PreviewSettings>) =>
      setPreviewState((current) => ({ ...current, ...patch })),
    [],
  );
  useEffect(() => savePreviewSettings(preview), [preview]);

  // ---- Waveform -----------------------------------------------------------
  // Hosted download links are re-signed on every response, so the first one
  // seen is kept rather than following the prop.

  const [waveSource, setWaveSource] = useState(project.audioUrl);
  if (!waveSource && project.audioUrl) setWaveSource(project.audioUrl);
  const [waveform, setWaveform] = useState<Waveform>({ status: "idle" });
  useEffect(() => {
    if (!waveSource) return;
    const controller = new AbortController();
    setWaveform({ status: "loading" });
    loadWaveformPeaks(waveSource, controller.signal).then(
      (peaks) => setWaveform({ status: "ready", peaks }),
      () => {
        if (!controller.signal.aborted) setWaveform({ status: "unavailable" });
      },
    );
    return () => controller.abort();
  }, [waveSource]);

  // ---- Keyboard -----------------------------------------------------------

  useEffect(() => {
    // Set while a space press was taken as play/pause on a button, so the
    // release does not click that button as well.
    let swallowSpaceUp = false;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return;
      // A dialog over the editor has the keyboard to itself.
      if (document.querySelector('[aria-modal="true"]')) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (command && (key === "z" || key === "y")) {
        // Text being typed keeps the browser's undo. Everything else, sliders
        // and color pickers included, reaches the editor's history.
        if (isTextEntry(target) && !target?.hasAttribute(EDITOR_UNDO_ATTRIBUTE))
          return;
        event.preventDefault();
        if (key === "y" || event.shiftKey) redo();
        else undo();
      } else if (command) {
        return;
      } else if (event.key === " ") {
        if (isTextEntry(target) || target?.closest(TYPES_SPACE)) return;
        const control = target?.closest<HTMLElement>(PRESSED_BY_SPACE) ?? null;
        // A control reached with the keyboard keeps the space bar. After a
        // mouse click it is the play key again, as it is on the timeline.
        if (
          control &&
          !control.hasAttribute("data-timeline-item") &&
          pointerFocused.current !== control
        )
          return;
        event.preventDefault();
        swallowSpaceUp = control !== null;
        player?.toggle();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (target?.closest(USES_ARROWS)) return;
        event.preventDefault();
        const step =
          (event.shiftKey ? fps : 1) * (key === "arrowleft" ? -1 : 1);
        seekToFrame(stores.frame.get() + step);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== " " || !swallowSpaceUp) return;
      swallowSpaceUp = false;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [fps, player, redo, seekToFrame, stores, undo]);

  const studio = useMemo<StudioContextValue>(
    () => ({
      project,
      duration,
      fps,
      ready,
      locked,
      style,
      words,
      setStyle,
      patchStyle,
      applyTemplate,
      setWords,
      resetWords,
      restoreCount,
      undo,
      redo,
      canUndo: history.past.length > 0 && !locked,
      canRedo: history.future.length > 0 && !locked,
      saveState,
      saveError,
      retrySave: () => void runSaves(),
      selectedWordIndex,
      selectWord,
      activeTab,
      setActiveTab,
      preview,
      setPreview,
      mediaSrc,
      waveform,
      exportOverlay,
      saveExport,
    }),
    [
      activeTab,
      applyTemplate,
      duration,
      exportOverlay,
      fps,
      history.future.length,
      history.past.length,
      locked,
      mediaSrc,
      patchStyle,
      preview,
      project,
      ready,
      redo,
      resetWords,
      restoreCount,
      runSaves,
      saveError,
      saveExport,
      saveState,
      selectWord,
      selectedWordIndex,
      setPreview,
      setStyle,
      setWords,
      style,
      undo,
      waveform,
      words,
    ],
  );

  return (
    <StudioContext.Provider value={studio}>
      <PlaybackContext.Provider value={playback}>
        <PlayheadContext.Provider value={stores}>
          {children}
        </PlayheadContext.Provider>
      </PlaybackContext.Provider>
    </StudioContext.Provider>
  );
}

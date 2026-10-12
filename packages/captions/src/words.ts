import type { CaptionWord } from "@caption-generator/types";

export const WORD_LIMITS = {
  /** Most words a project may hold. */
  count: 20_000,
  /** Longest text of a single word. */
  textLength: 80,
  /** Shortest time a word may stay on screen, in seconds. */
  duration: 0.02,
} as const;

// The export keeps rendering for a moment after the audio ends.
const TAIL_SECONDS = 0.25;

const round3 = (value: number) => Math.round(value * 1000) / 1000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Control characters are dropped, and the cut is made between code points so
// an emoji at the limit is never left as half a character.
export const cleanWordText = (text: string) =>
  Array.from(
    text
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, WORD_LIMITS.textLength)
    .join("")
    .trim();

/**
 * Turns edited or stored words into a list the renderer can trust: no empty
 * text, times inside the clip, each word at least a few frames long, ordered
 * by start time. Words that share a start time keep their given order.
 */
export const sanitizeWords = (
  raw: unknown,
  durationSeconds: number | null,
): CaptionWord[] => {
  if (!Array.isArray(raw)) return [];
  const limit =
    durationSeconds && durationSeconds > 0
      ? durationSeconds + TAIL_SECONDS
      : Number.POSITIVE_INFINITY;
  const words: CaptionWord[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.text !== "string") continue;
    const text = cleanWordText(item.text);
    const start = typeof item.start === "number" ? item.start : Number.NaN;
    const end = typeof item.end === "number" ? item.end : Number.NaN;
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    const safeStart = Math.min(
      Math.max(0, start),
      Math.max(0, limit - WORD_LIMITS.duration),
    );
    const safeEnd = Math.min(
      limit,
      Math.max(safeStart + WORD_LIMITS.duration, end),
    );
    words.push({ text, start: round3(safeStart), end: round3(safeEnd) });
    if (words.length >= WORD_LIMITS.count) break;
  }
  return words
    .map((word, index) => ({ word, index }))
    .sort((a, b) => a.word.start - b.word.start || a.index - b.index)
    .map(({ word }) => word);
};

/** The plain transcript, as kept next to the words. */
export const wordsToText = (words: CaptionWord[]) =>
  words.map((word) => word.text).join(" ");

/**
 * The word a caption is on at a point in time: the last one that has started,
 * so it stays put through a pause. Before the first word it is 0.
 */
export const findActiveWordIndex = (words: CaptionWord[], seconds: number) => {
  // Words are ordered by start, so this is the last one that has started.
  // Where two words overlap, the later one takes the highlight.
  let low = 0;
  let high = words.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const word = words[middle];
    if (word && word.start <= seconds) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
};

/** Whether the first word has started, that is, whether anything is spoken yet. */
export const hasSpeechStarted = (words: CaptionWord[], seconds: number) => {
  const first = words[0];
  return first !== undefined && seconds >= first.start;
};

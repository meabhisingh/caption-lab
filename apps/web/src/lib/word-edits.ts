import {
  WORD_LIMITS,
  cleanWordText,
  sanitizeWords,
} from "@caption-generator/captions";
import type { CaptionWord } from "@caption-generator/types";

// Pure edits on the list of caption words. Every function returns a new,
// sanitized list and keeps the words in the same order, so an index stays
// valid across an edit unless that word itself was removed.

const MIN = WORD_LIMITS.duration;

/** Changes the text of a word. Empty text leaves the list as it is. */
export const setWordText = (
  words: CaptionWord[],
  index: number,
  text: string,
  duration: number,
) => {
  const cleaned = cleanWordText(text);
  if (!words[index] || !cleaned) return words;
  return sanitizeWords(
    words.map((word, at) => (at === index ? { ...word, text: cleaned } : word)),
    duration,
  );
};

/**
 * Moves the start or the end of a word. An edge moved into a neighbouring
 * word trims that neighbour instead of covering it, and stops when only a
 * sliver of the neighbour is left. Words never overlap more than they already
 * did and never change order.
 */
export const retimeWord = (
  words: CaptionWord[],
  index: number,
  timing: { start?: number; end?: number },
  duration: number,
) => {
  const word = words[index];
  if (!word) return words;
  const previous = words[index - 1];
  const next = words[index + 1];
  const minStart = previous ? Math.min(word.start, previous.start + MIN) : 0;
  // The next word's start is pushed along, but not past the word after it.
  const maxEnd = next
    ? Math.max(
        word.end,
        Math.min(
          next.end - MIN,
          words[index + 2]?.start ?? Number.POSITIVE_INFINITY,
        ),
      )
    : Number.POSITIVE_INFINITY;
  const maxStart = Math.min(
    (timing.end === undefined ? word.end : maxEnd) - MIN,
    next ? Math.max(word.start, next.start) : Number.POSITIVE_INFINITY,
  );
  const start = Math.min(
    Math.max(timing.start ?? word.start, minStart),
    Math.max(minStart, maxStart),
  );
  const end = Math.min(
    Math.max(timing.end ?? word.end, start + MIN),
    Math.max(maxEnd, start + MIN),
  );
  return sanitizeWords(
    words.map((item, at) => {
      if (at === index) return { ...item, start, end };
      // Only an edge that grew into its neighbour trims it.
      if (at === index - 1 && start < word.start && item.end > start)
        return { ...item, end: Math.max(item.start + MIN, start) };
      if (at === index + 1 && end > word.end && item.start < end)
        return { ...item, start: Math.min(item.end - MIN, end) };
      return item;
    }),
    duration,
  );
};

/** Removes a word. The last remaining word cannot be removed. */
export const deleteWord = (
  words: CaptionWord[],
  index: number,
  duration: number,
) => {
  if (!words[index] || words.length <= 1) return words;
  return sanitizeWords(
    words.filter((_, at) => at !== index),
    duration,
  );
};

/**
 * Splits a word in two, at its first space or else in the middle, and divides
 * its time between the halves in proportion to their length.
 */
export const splitWord = (
  words: CaptionWord[],
  index: number,
  duration: number,
) => {
  const word = words[index];
  if (!word || word.text.length < 2) return words;
  const space = word.text.indexOf(" ");
  const cut = space > 0 ? space : Math.ceil(word.text.length / 2);
  const first = word.text.slice(0, cut).trim();
  const second = word.text.slice(cut).trim();
  if (!first || !second) return words;
  const span = Math.max(MIN * 2, word.end - word.start);
  // The second half never starts after the following word, or it would be
  // sorted behind it.
  const middle = Math.min(
    word.start + (span * first.length) / (first.length + second.length),
    words[index + 1]?.start ?? Number.POSITIVE_INFINITY,
  );
  return sanitizeWords(
    [
      ...words.slice(0, index),
      { text: first, start: word.start, end: middle },
      { text: second, start: middle, end: Math.max(word.end, middle + MIN) },
      ...words.slice(index + 1),
    ],
    duration,
  );
};

/** Joins a word with the one after it into a single highlighted unit. */
export const mergeWithNext = (
  words: CaptionWord[],
  index: number,
  duration: number,
) => {
  const word = words[index];
  const next = words[index + 1];
  if (!word || !next) return words;
  return sanitizeWords(
    [
      ...words.slice(0, index),
      {
        text: `${word.text} ${next.text}`,
        start: word.start,
        end: Math.max(word.end, next.end),
      },
      ...words.slice(index + 2),
    ],
    duration,
  );
};

/**
 * Adds a word after the given one. It takes the silence that follows, or the
 * second half of the given word when there is no silence to use.
 */
export const insertWordAfter = (
  words: CaptionWord[],
  index: number,
  text: string,
  duration: number,
) => {
  const word = words[index];
  const cleaned = cleanWordText(text);
  if (!word || !cleaned) return words;
  const nextStart = words[index + 1]?.start ?? duration;
  const gap = nextStart - word.end;
  const roomy = gap >= 0.12;
  // Never after the following word starts, so the new word stays right here.
  const start = roomy
    ? word.end
    : Math.min(word.start + (word.end - word.start) / 2, nextStart);
  const end = roomy ? Math.min(nextStart, word.end + 0.4) : word.end;
  return sanitizeWords(
    [
      ...words.slice(0, index),
      roomy ? word : { ...word, end: start },
      { text: cleaned, start, end },
      ...words.slice(index + 1),
    ],
    duration,
  );
};

/** Moves every word earlier (negative) or later (positive), in seconds. */
export const shiftWords = (
  words: CaptionWord[],
  seconds: number,
  duration: number,
) =>
  sanitizeWords(
    words.map((word) => ({
      ...word,
      start: word.start + seconds,
      end: word.end + seconds,
    })),
    duration,
  );

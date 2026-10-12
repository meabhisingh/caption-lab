import type { CaptionStyle, CaptionWord } from "@caption-generator/types";
import { Audio } from "@remotion/media";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AbsoluteFill,
  Html5Audio,
  Html5Video,
  interpolate,
  spring,
  useCurrentFrame,
  useDelayRender,
  useRemotionEnvironment,
  useVideoConfig,
} from "remotion";
import "./font-faces";
import {
  captionFontShorthand,
  captionLineStyle,
  captionPlacementStyle,
  captionRowStyle,
  captionWordStyle,
  captionWordText,
} from "./render-style";
import { normalizeCaptionStyle } from "./style";
import { findActiveWordIndex, hasSpeechStarted } from "./words";

export type CaptionCompositionProps = {
  words: CaptionWord[];
  style: CaptionStyle;
  durationSeconds: number;
  /** Preview only: the source media, played for its sound. */
  audioSrc?: string;
  includeAudio?: boolean;
  /** Preview only: the source video, shown behind the captions. */
  videoSrc?: string;
};

const AudioTrack = ({ src }: { src: string }) => {
  const environment = useRemotionEnvironment();
  return environment.isRendering ? (
    <Audio src={src} />
  ) : (
    <Html5Audio src={src} />
  );
};

// Every distinct character of the transcript, so the browser fetches each
// subset file of the font that the captions need.
const sampleText = (words: CaptionWord[], uppercase: boolean) => {
  const characters = new Set<string>();
  for (const word of words) {
    for (const character of uppercase ? word.text.toUpperCase() : word.text) {
      characters.add(character);
      if (characters.size >= 2000) break;
    }
  }
  return [...characters].join("") || "Aa";
};

// Holds the render back until the caption font is ready, so the first frames
// are not drawn with a fallback font. In the preview the font simply swaps in.
const useCaptionFont = (style: CaptionStyle, words: CaptionWord[]) => {
  const { delayRender, continueRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Loading the caption font"));
  const font = captionFontShorthand(style);
  const sample = useMemo(
    () => sampleText(words, style.uppercase),
    [words, style.uppercase],
  );

  // Kept in a ref so the font is only requested again when it changes, not
  // whenever Remotion hands out a new callback.
  const finish = useRef(continueRender);
  useEffect(() => {
    finish.current = continueRender;
  });

  useEffect(() => {
    let cancelled = false;
    const done = () => {
      if (!cancelled) finish.current(handle);
    };
    if (typeof document === "undefined" || !document.fonts) {
      done();
      return;
    }
    document.fonts.load(font, sample).then(done, done);
    return () => {
      cancelled = true;
    };
  }, [font, handle, sample]);
};

export function CaptionComposition({
  words,
  style: rawStyle,
  audioSrc,
  includeAudio = false,
  videoSrc,
}: CaptionCompositionProps) {
  const style = useMemo(() => normalizeCaptionStyle(rawStyle), [rawStyle]);
  useCaptionFont(style, words);

  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const activeIndex = findActiveWordIndex(words, seconds);
  const pageSize = Math.max(1, style.maxWords);
  const pageStart = Math.floor(activeIndex / pageSize) * pageSize;
  const visibleWords = words.slice(pageStart, pageStart + pageSize);
  const activeWord = words[activeIndex];
  const wordFrame = activeWord
    ? Math.max(0, frame - activeWord.start * fps)
    : 0;
  const entrance = spring({
    frame: wordFrame,
    fps,
    config: { damping: 16, stiffness: 260, mass: 0.55 },
  });
  const clamp = {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  } as const;
  // A word on a highlight box settles at its own size: grown past it, the box
  // would cover the letters of the neighbouring words.
  const pop = style.activeBackgroundOpacity > 0 ? [0.9, 1] : [0.82, 1.08];
  const motion =
    style.animation === "pop"
      ? { scale: interpolate(entrance, [0, 1], pop, clamp) }
      : style.animation === "rise"
        ? { shift: interpolate(entrance, [0, 1], [0.28, 0], clamp) }
        : {};
  // Until the first word is spoken the line is shown with nothing highlighted.
  const highlighted = hasSpeechStarted(words, seconds) ? activeIndex : -1;

  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      {videoSrc ? (
        <Html5Video
          src={videoSrc}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : includeAudio && audioSrc ? (
        <AudioTrack src={audioSrc} />
      ) : null}
      <div style={captionRowStyle(style)}>
        <div
          style={{
            ...captionLineStyle(style),
            ...captionPlacementStyle(style),
          }}
        >
          {visibleWords.map((word, localIndex) => {
            const index = pageStart + localIndex;
            return (
              <span
                key={`${word.start}-${index}`}
                style={captionWordStyle(
                  style,
                  index === highlighted,
                  1,
                  motion,
                )}
              >
                {captionWordText(style, word.text)}
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}

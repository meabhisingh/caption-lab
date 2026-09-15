import type { CaptionStyle, CaptionWord } from "@caption-generator/types";
import { Audio } from "@remotion/media";
import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Html5Audio,
  interpolate,
  spring,
  useCurrentFrame,
  useRemotionEnvironment,
  useVideoConfig,
} from "remotion";

export type CaptionCompositionProps = {
  words: CaptionWord[];
  style: CaptionStyle;
  durationSeconds: number;
  audioSrc?: string;
  includeAudio?: boolean;
};

const findActiveIndex = (words: CaptionWord[], seconds: number) => {
  const exactIndex = words.findIndex(
    (word) => seconds >= word.start && seconds < word.end,
  );
  if (exactIndex >= 0) return exactIndex;
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index];
    if (word && seconds >= word.start) return index;
  }
  return 0;
};

const AudioTrack = ({ src }: { src: string }) => {
  const environment = useRemotionEnvironment();
  return environment.isRendering ? (
    <Audio src={src} />
  ) : (
    <Html5Audio src={src} />
  );
};

export function CaptionComposition({
  words,
  style,
  audioSrc,
  includeAudio = false,
}: CaptionCompositionProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const activeIndex = findActiveIndex(words, seconds);
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
  const activeScale = interpolate(entrance, [0, 1], [0.82, 1.08], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const lineStyle: CSSProperties = {
    maxWidth: "90%",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.18em 0.28em",
    padding: style.backgroundOpacity > 0 ? "0.32em 0.46em" : 0,
    borderRadius: style.borderRadius,
    backgroundColor:
      style.backgroundOpacity > 0
        ? `${style.backgroundColor}${Math.round(style.backgroundOpacity * 255)
            .toString(16)
            .padStart(2, "0")}`
        : "transparent",
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: 1.06,
    letterSpacing: style.uppercase ? "-0.035em" : "-0.025em",
    textAlign: "center",
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      {includeAudio && audioSrc ? <AudioTrack src={audioSrc} /> : null}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-start",
          paddingTop: `${style.positionY}%`,
        }}
      >
        <div style={lineStyle}>
          {visibleWords.map((word, localIndex) => {
            const index = pageStart + localIndex;
            const isActive = index === activeIndex;
            return (
              <span
                key={`${word.start}-${index}`}
                style={{
                  display: "inline-block",
                  color: isActive ? style.activeColor : style.textColor,
                  WebkitTextStroke: `${style.strokeWidth}px ${style.strokeColor}`,
                  paintOrder: "stroke fill",
                  textShadow:
                    style.templateId === "neon" && isActive
                      ? `0 0 18px ${style.activeColor}, 0 0 42px ${style.activeColor}`
                      : "0 6px 20px rgba(0,0,0,0.38)",
                  transform: `scale(${isActive ? activeScale : 1})`,
                  transformOrigin: "center",
                }}
              >
                {style.uppercase ? word.text.toUpperCase() : word.text}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

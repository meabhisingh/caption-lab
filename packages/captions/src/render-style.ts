import type { CaptionStyle } from "@caption-generator/types";
import type { CSSProperties } from "react";
import { withOpacity } from "./style";

// The CSS for a caption, shared by the Remotion composition and the static
// previews in the editor so both always draw a style the same way. `scale`
// shrinks every pixel value for previews smaller than the 1080x1920 canvas.

const JUSTIFY = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
} as const;

const px = (value: number, scale: number) =>
  `${Math.round(value * scale * 100) / 100}px`;

const hasHighlightBox = (style: CaptionStyle) =>
  style.activeBackgroundOpacity > 0;

/**
 * A canvas-wide row that centers the caption line on `positionX`. The line is
 * placed by layout rather than by a transform so its edges land on whole
 * pixels and stay crisp.
 */
export const captionRowStyle = (style: CaptionStyle): CSSProperties => ({
  position: "absolute",
  top: `${style.positionY}%`,
  left: `${style.positionX - 50}%`,
  width: "100%",
  display: "flex",
  justifyContent: "center",
});

/** Width limit, rotation and opacity of the caption line on the canvas. */
export const captionPlacementStyle = (style: CaptionStyle): CSSProperties => ({
  maxWidth: `${style.maxWidth}%`,
  ...(style.rotation !== 0
    ? { transform: `rotate(${style.rotation}deg)` }
    : {}),
  ...(style.opacity < 1 ? { opacity: style.opacity } : {}),
});

/** The line of words, including the box behind it. */
export const captionLineStyle = (
  style: CaptionStyle,
  scale = 1,
): CSSProperties => ({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: JUSTIFY[style.textAlign],
  // Words carry their own padding when a highlight box is drawn behind them.
  gap: hasHighlightBox(style) ? "0.14em 0.04em" : "0.18em 0.28em",
  padding: style.backgroundOpacity > 0 ? "0.32em 0.46em" : 0,
  borderRadius: px(style.borderRadius, scale),
  backgroundColor:
    style.backgroundOpacity > 0
      ? withOpacity(style.backgroundColor, style.backgroundOpacity)
      : "transparent",
  fontFamily: style.fontFamily,
  fontSize: px(style.fontSize, scale),
  fontWeight: style.fontWeight,
  fontStyle: style.italic ? "italic" : "normal",
  lineHeight: 1.06,
  letterSpacing: `${style.letterSpacing}em`,
  textAlign: style.textAlign,
});

const shadowFor = (style: CaptionStyle, active: boolean, scale: number) => {
  const soft = `0 ${px(6, scale)} ${px(20, scale)} rgba(0,0,0,0.38)`;
  switch (style.shadow) {
    case "none":
      return "none";
    case "hard": {
      const offset = style.fontSize * 0.07;
      const shade = style.strokeWidth > 0 ? style.strokeColor : "#000000";
      return `${px(offset * 0.8, scale)} ${px(offset, scale)} 0 ${shade}`;
    }
    case "glow":
      return active
        ? `0 0 ${px(18, scale)} ${style.activeColor}, 0 0 ${px(42, scale)} ${style.activeColor}`
        : soft;
    default:
      return soft;
  }
};

export type CaptionWordMotion = {
  /** Scale of the word being spoken. */
  scale?: number;
  /** Upward offset of the word being spoken, in em. */
  shift?: number;
};

/** One word, including the highlight box behind the word being spoken. */
export const captionWordStyle = (
  style: CaptionStyle,
  active: boolean,
  scale = 1,
  motion: CaptionWordMotion = {},
): CSSProperties => {
  const boxed = hasHighlightBox(style);
  // On its box the spoken word needs no outline or shadow to stay readable,
  // and an outline in the text's own color would only smear the letters.
  const onBox = boxed && active;
  const transforms: string[] = [];
  if (active && motion.shift) transforms.push(`translateY(${motion.shift}em)`);
  if (active && motion.scale && motion.scale !== 1)
    transforms.push(`scale(${motion.scale})`);
  return {
    display: "inline-block",
    color: active ? style.activeColor : style.textColor,
    opacity: active ? 1 : style.inactiveOpacity,
    // Letter spacing also follows the last letter, inside the box. The left
    // padding takes up the same amount so the word sits centered in its box.
    padding: boxed
      ? `0.05em 0.16em 0.05em ${Math.round((0.16 + style.letterSpacing) * 1000) / 1000}em`
      : 0,
    borderRadius: boxed
      ? px(Math.min(style.borderRadius, style.fontSize / 2) * 0.7, scale)
      : 0,
    backgroundColor: onBox
      ? withOpacity(style.activeBackgroundColor, style.activeBackgroundOpacity)
      : "transparent",
    WebkitTextStroke: `${px(onBox ? 0 : style.strokeWidth, scale)} ${style.strokeColor}`,
    paintOrder: "stroke fill",
    textShadow: onBox ? "none" : shadowFor(style, active, scale),
    transform: transforms.length ? transforms.join(" ") : "none",
    transformOrigin: "center",
  };
};

export const captionWordText = (style: CaptionStyle, text: string) =>
  style.uppercase ? text.toUpperCase() : text;

/** CSS `font` shorthand for a style, for `document.fonts.load`. */
export const captionFontShorthand = (style: CaptionStyle) =>
  `${style.italic ? "italic " : ""}${Math.round(style.fontWeight)} 48px ${style.fontFamily}`;

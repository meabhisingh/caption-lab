import type {
  CaptionAlign,
  CaptionAnimation,
  CaptionShadow,
  CaptionStyle,
  CaptionTemplateId,
} from "@caption-generator/types";
import { CAPTION_TEMPLATES } from "./templates";

export const CAPTION_SHADOWS = [
  "none",
  "soft",
  "hard",
  "glow",
] as const satisfies readonly CaptionShadow[];

export const CAPTION_ANIMATIONS = [
  "pop",
  "rise",
  "none",
] as const satisfies readonly CaptionAnimation[];

export const CAPTION_ALIGNMENTS = [
  "left",
  "center",
  "right",
] as const satisfies readonly CaptionAlign[];

/** Allowed range of every numeric style field; the API enforces the same. */
export const CAPTION_LIMITS = {
  fontSize: { min: 28, max: 160 },
  fontWeight: { min: 100, max: 950 },
  letterSpacing: { min: -0.08, max: 0.4 },
  activeBackgroundOpacity: { min: 0, max: 1 },
  inactiveOpacity: { min: 0.1, max: 1 },
  strokeWidth: { min: 0, max: 20 },
  backgroundOpacity: { min: 0, max: 1 },
  borderRadius: { min: 0, max: 80 },
  maxWords: { min: 1, max: 10 },
  positionX: { min: 5, max: 95 },
  positionY: { min: 2, max: 92 },
  maxWidth: { min: 30, max: 100 },
  opacity: { min: 0, max: 1 },
  rotation: { min: -20, max: 20 },
} as const;

export const MAX_FONT_FAMILY_LENGTH = 120;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Before version 2 the vertical position was applied as CSS `padding-top: N%`,
// which resolves against the canvas width. On the 1080x1920 canvas that put
// the caption at N * 1080 / 1920 percent of the height.
const LEGACY_POSITION_Y_SCALE = 1080 / 1920;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Four decimals keeps a migrated vertical position exact (N * 0.5625).
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

const number = (
  value: unknown,
  fallback: number,
  limits: { min: number; max: number },
) => {
  const parsed = typeof value === "number" ? value : Number.NaN;
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return round4(Math.min(limits.max, Math.max(limits.min, safe)));
};

const color = (value: unknown, fallback: string) =>
  typeof value === "string" && HEX_COLOR.test(value)
    ? value.toLowerCase()
    : fallback;

const boolean = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const oneOf = <T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
) => (options.includes(value as T) ? (value as T) : fallback);

export const isCaptionTemplateId = (
  value: unknown,
): value is CaptionTemplateId =>
  typeof value === "string" && Object.hasOwn(CAPTION_TEMPLATES, value);

/**
 * Turns whatever was stored for a project into a complete, in-range style.
 * Styles saved before version 2 keep the exact look they rendered with.
 */
export const normalizeCaptionStyle = (raw: unknown): CaptionStyle => {
  const input = isRecord(raw) ? raw : {};
  const templateId = isCaptionTemplateId(input.templateId)
    ? input.templateId
    : "viral";
  const template = CAPTION_TEMPLATES[templateId];
  const legacy = input.version !== 2;
  const uppercase = boolean(input.uppercase, template.uppercase);
  const givenFont =
    typeof input.fontFamily === "string"
      ? input.fontFamily.replace(/[\u0000-\u001f\u007f]/g, "").trim()
      : "";
  const fontFamily = givenFont
    ? givenFont.slice(0, MAX_FONT_FAMILY_LENGTH)
    : template.fontFamily;
  const strokeIsColor =
    typeof input.strokeColor === "string" && HEX_COLOR.test(input.strokeColor);

  const shared = {
    version: 2 as const,
    templateId,
    fontFamily,
    fontSize: number(
      input.fontSize,
      template.fontSize,
      CAPTION_LIMITS.fontSize,
    ),
    fontWeight: number(
      input.fontWeight,
      template.fontWeight,
      CAPTION_LIMITS.fontWeight,
    ),
    uppercase,
    textColor: color(input.textColor, template.textColor),
    activeColor: color(input.activeColor, template.activeColor),
    strokeColor: color(input.strokeColor, "#000000"),
    // A stroke saved with a non-hex color such as "transparent" was invisible.
    strokeWidth:
      input.strokeColor === undefined || strokeIsColor
        ? number(
            input.strokeWidth,
            template.strokeWidth,
            CAPTION_LIMITS.strokeWidth,
          )
        : 0,
    backgroundColor: color(input.backgroundColor, template.backgroundColor),
    backgroundOpacity: number(
      input.backgroundOpacity,
      template.backgroundOpacity,
      CAPTION_LIMITS.backgroundOpacity,
    ),
    borderRadius: number(
      input.borderRadius,
      template.borderRadius,
      CAPTION_LIMITS.borderRadius,
    ),
    maxWords: Math.round(
      number(input.maxWords, template.maxWords, CAPTION_LIMITS.maxWords),
    ),
  };

  if (legacy) {
    const legacyY =
      typeof input.positionY === "number" && Number.isFinite(input.positionY)
        ? input.positionY * LEGACY_POSITION_Y_SCALE
        : template.positionY;
    return {
      ...shared,
      italic: false,
      letterSpacing: uppercase ? -0.035 : -0.025,
      activeBackgroundColor: "#000000",
      activeBackgroundOpacity: 0,
      inactiveOpacity: 1,
      shadow: templateId === "neon" ? "glow" : "soft",
      animation: "pop",
      positionX: 50,
      positionY: number(legacyY, template.positionY, CAPTION_LIMITS.positionY),
      maxWidth: 90,
      textAlign: "center",
      opacity: 1,
      rotation: 0,
    };
  }

  return {
    ...shared,
    italic: boolean(input.italic, template.italic),
    letterSpacing: number(
      input.letterSpacing,
      template.letterSpacing,
      CAPTION_LIMITS.letterSpacing,
    ),
    activeBackgroundColor: color(
      input.activeBackgroundColor,
      template.activeBackgroundColor,
    ),
    activeBackgroundOpacity: number(
      input.activeBackgroundOpacity,
      template.activeBackgroundOpacity,
      CAPTION_LIMITS.activeBackgroundOpacity,
    ),
    inactiveOpacity: number(
      input.inactiveOpacity,
      template.inactiveOpacity,
      CAPTION_LIMITS.inactiveOpacity,
    ),
    shadow: oneOf(input.shadow, CAPTION_SHADOWS, template.shadow),
    animation: oneOf(input.animation, CAPTION_ANIMATIONS, template.animation),
    positionX: number(
      input.positionX,
      template.positionX,
      CAPTION_LIMITS.positionX,
    ),
    positionY: number(
      input.positionY,
      template.positionY,
      CAPTION_LIMITS.positionY,
    ),
    maxWidth: number(
      input.maxWidth,
      template.maxWidth,
      CAPTION_LIMITS.maxWidth,
    ),
    textAlign: oneOf(input.textAlign, CAPTION_ALIGNMENTS, template.textAlign),
    opacity: number(input.opacity, template.opacity, CAPTION_LIMITS.opacity),
    rotation: number(
      input.rotation,
      template.rotation,
      CAPTION_LIMITS.rotation,
    ),
  };
};

/** Whether two styles would render the same. */
export const sameCaptionStyle = (left: CaptionStyle, right: CaptionStyle) =>
  (Object.keys(left) as Array<keyof CaptionStyle>).every(
    (key) => left[key] === right[key],
  );

/** `#rrggbb` plus an opacity from 0 to 1, as a CSS color. */
export const withOpacity = (hex: string, opacity: number) => {
  const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${alpha}`;
};

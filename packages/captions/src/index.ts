// Data and logic only, so the API can load this entry in plain Node. The React
// components live behind "./composition" because they import font CSS.
export {
  CAPTION_FONTS,
  closestFontWeight,
  findCaptionFont,
  primaryFontName,
} from "./fonts";
export type { CaptionFont, CaptionFontCategory } from "./fonts";
export {
  CAPTION_ALIGNMENTS,
  CAPTION_ANIMATIONS,
  CAPTION_LIMITS,
  CAPTION_SHADOWS,
  MAX_FONT_FAMILY_LENGTH,
  isCaptionTemplateId,
  normalizeCaptionStyle,
  sameCaptionStyle,
  withOpacity,
} from "./style";
export {
  CAPTION_TEMPLATES,
  CAPTION_TEMPLATE_IDS,
  CAPTION_TEMPLATE_LIST,
  DEFAULT_CAPTION_STYLE,
} from "./templates";
export {
  WORD_LIMITS,
  cleanWordText,
  findActiveWordIndex,
  hasSpeechStarted,
  sanitizeWords,
  wordsToText,
} from "./words";

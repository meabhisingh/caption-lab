import type { CaptionStyle } from "@caption-generator/types";
import "./font-faces";
import {
  captionLineStyle,
  captionWordStyle,
  captionWordText,
} from "./render-style";

export type CaptionPreviewProps = {
  style: CaptionStyle;
  /** Words to draw; one of them is shown as the word being spoken. */
  words?: readonly string[];
  activeIndex?: number;
  /** Size relative to the 1080x1920 canvas. */
  scale?: number;
};

const SAMPLE_WORDS = ["Say", "it", "loud"] as const;

/**
 * A still caption, drawn with the same CSS as the rendered video. For template
 * thumbnails and other places that need a picture of a style without a player.
 */
export function CaptionPreview({
  style,
  words = SAMPLE_WORDS,
  activeIndex = 1,
  scale = 0.25,
}: CaptionPreviewProps) {
  return (
    <div
      style={{
        width: "max-content",
        maxWidth: "100%",
        opacity: style.opacity,
        transform: `rotate(${style.rotation}deg)`,
      }}
    >
      <div style={captionLineStyle(style, scale)}>
        {words.slice(0, Math.max(1, style.maxWords)).map((word, index) => (
          <span
            key={`${word}-${index}`}
            style={captionWordStyle(style, index === activeIndex, scale)}
          >
            {captionWordText(style, word)}
          </span>
        ))}
      </div>
    </div>
  );
}

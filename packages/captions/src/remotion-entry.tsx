import { Composition, registerRoot } from "remotion";
import {
  CaptionComposition,
  type CaptionCompositionProps,
} from "./caption-composition";
import { DEFAULT_CAPTION_STYLE } from "./templates";

const defaultProps: CaptionCompositionProps = {
  words: [{ text: "CAPTIONS", start: 0, end: 2 }],
  style: DEFAULT_CAPTION_STYLE,
  durationSeconds: 2,
  includeAudio: false,
};

const RemotionRoot = () => (
  <Composition
    id="CaptionOverlay"
    component={CaptionComposition}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={60}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(
        1,
        Math.ceil((props.durationSeconds + 0.25) * 30),
      ),
    })}
  />
);

registerRoot(RemotionRoot);

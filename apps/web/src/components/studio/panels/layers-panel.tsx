"use client";

import { CAPTION_LIMITS } from "@caption-generator/captions";
import type { CaptionAlign, CaptionStyle } from "@caption-generator/types";
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  Eye,
  EyeOff,
  Highlighter,
  Image as ImageIcon,
  Layers3,
  Lock,
  Move,
  RectangleHorizontal,
  Smartphone,
  Type,
  Video,
  type LucideIcon,
} from "lucide-react";
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import type { PreviewBackdrop, SafeZone } from "@/lib/preview-settings";
import { useStudio } from "../studio-context";
import {
  ColorField,
  EmptyState,
  IconButton,
  PanelHeader,
  Section,
  SegmentedControl,
  SliderField,
  cn,
} from "../ui";

type StyleLayerId = "highlight" | "text" | "line";
type LayerId = StyleLayerId | "safe" | "backdrop";
type ChosenZone = Exclude<SafeZone, "none">;

/** What each eye brings back after its layer was hidden. */
type Remembered = Record<StyleLayerId, number> & { zone: ChosenZone };

const INITIAL_REMEMBERED: Remembered = {
  highlight: 1,
  text: 1,
  line: 0.8,
  zone: "tiktok",
};

const OPACITY_FIELD = {
  highlight: "activeBackgroundOpacity",
  text: "opacity",
  line: "backgroundOpacity",
} as const satisfies Record<StyleLayerId, keyof CaptionStyle>;

const LAYERS: ReadonlyArray<{
  id: LayerId;
  name: string;
  icon: LucideIcon;
  editorOnly: boolean;
}> = [
  {
    id: "highlight",
    name: "Highlight box",
    icon: Highlighter,
    editorOnly: false,
  },
  { id: "text", name: "Caption text", icon: Type, editorOnly: false },
  {
    id: "line",
    name: "Line background",
    icon: RectangleHorizontal,
    editorOnly: false,
  },
  { id: "safe", name: "Safe-area guide", icon: Smartphone, editorOnly: true },
  { id: "backdrop", name: "Backdrop", icon: ImageIcon, editorOnly: true },
];

const SAFE_ZONE_LABELS: Record<SafeZone, string> = {
  none: "Off",
  tiktok: "TikTok",
  reels: "Reels",
  shorts: "Shorts",
};

const SAFE_ZONE_OPTIONS = (Object.keys(SAFE_ZONE_LABELS) as SafeZone[]).map(
  (value) => ({ value, label: SAFE_ZONE_LABELS[value] }),
);

const CHECKERBOARD: CSSProperties = {
  backgroundColor: "#17171b",
  backgroundImage:
    "linear-gradient(45deg,#3a3a42 25%,transparent 25%,transparent 75%,#3a3a42 75%),linear-gradient(45deg,#3a3a42 25%,transparent 25%,transparent 75%,#3a3a42 75%)",
  backgroundSize: "8px 8px",
  backgroundPosition: "0 0,4px 4px",
};

const BACKDROP_OPTIONS: ReadonlyArray<{
  value: PreviewBackdrop;
  label: string;
  /** Swatch fill; the source video shows an icon instead. */
  swatch: CSSProperties | null;
}> = [
  { value: "transparent", label: "Transparent", swatch: CHECKERBOARD },
  { value: "dark", label: "Dark", swatch: { backgroundColor: "#000000" } },
  { value: "light", label: "Light", swatch: { backgroundColor: "#ffffff" } },
  {
    value: "green",
    label: "Green screen",
    swatch: { backgroundColor: "#00b140" },
  },
  { value: "video", label: "Source video", swatch: null },
];

const ALIGNMENTS: ReadonlyArray<{
  value: CaptionAlign;
  title: string;
  icon: LucideIcon;
}> = [
  { value: "left", title: "Align left", icon: AlignLeft },
  { value: "center", title: "Align center", icon: AlignCenter },
  { value: "right", title: "Align right", icon: AlignRight },
];

const ALIGN_OPTIONS = ALIGNMENTS.map(({ value, title, icon: Icon }) => ({
  value,
  title,
  // `relative` keeps the absolutely positioned sr-only text inside the
  // sidebar's scroll area; without it the text makes the whole page scroll.
  label: (
    <span className="relative grid place-items-center">
      <Icon size={14} aria-hidden />
      <span className="sr-only">{title}</span>
    </span>
  ),
}));

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lime-300/70";

const percent = (value: number) => `${Math.round(value * 100)}%`;
const tidy = (value: number) => String(Math.round(value * 10) / 10);
const asPercent = (value: number) => `${tidy(value)}%`;

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-4 text-zinc-500">{children}</p>;
}

function ColorDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 rounded-full border border-white/20"
      style={{ backgroundColor: color }}
    />
  );
}

function LayerRow({
  name,
  icon: Icon,
  summary,
  editorOnly,
  selected,
  dimmed,
  controls,
  onSelect,
  trailing,
}: {
  name: string;
  icon: LucideIcon;
  summary: ReactNode;
  editorOnly: boolean;
  selected: boolean;
  /** The layer is hidden, so the row is drawn muted. */
  dimmed: boolean;
  controls: string;
  onSelect: () => void;
  trailing: ReactNode;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-1 rounded-xl border pr-1.5 transition",
        selected
          ? "border-lime-300/40 bg-lime-300/6"
          : "border-white/[0.07] hover:border-white/15 hover:bg-white/3",
      )}
    >
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        aria-controls={controls}
        onClick={onSelect}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-2 pl-2 pr-1 text-left",
          FOCUS_RING,
        )}
      >
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg border",
            selected
              ? "border-lime-300/30 text-lime-300"
              : "border-white/10 text-zinc-400",
            dimmed && "opacity-40",
          )}
        >
          <Icon size={15} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "truncate text-xs font-medium",
                dimmed ? "text-zinc-500" : "text-zinc-200",
              )}
            >
              {name}
            </span>
            {editorOnly ? (
              <span className="shrink-0 rounded border border-white/10 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-zinc-500">
                Editor only
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
            {summary}
          </span>
        </span>
      </button>
      {trailing}
    </li>
  );
}

function PlacementButton({
  icon: Icon,
  label,
  title,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/10 text-[11px] font-medium text-zinc-300 transition hover:border-white/20 hover:bg-white/5 hover:text-white disabled:cursor-default disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:bg-transparent",
        FOCUS_RING,
      )}
    >
      <Icon size={13} aria-hidden className="text-zinc-500" />
      {label}
    </button>
  );
}

function CaptionTextProperties() {
  const { style, patchStyle, locked } = useStudio();
  const placementId = useId();
  return (
    <>
      <div role="group" aria-labelledby={placementId}>
        <p id={placementId} className="mb-2 text-xs text-zinc-400">
          Quick placement
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <PlacementButton
            icon={ArrowUpToLine}
            label="Top"
            title="Move the captions to the top"
            disabled={locked}
            onClick={() => patchStyle({ positionY: 10 })}
          />
          <PlacementButton
            icon={AlignVerticalJustifyCenter}
            label="Middle"
            title="Move the captions to the middle"
            disabled={locked}
            onClick={() => patchStyle({ positionY: 44 })}
          />
          <PlacementButton
            icon={ArrowDownToLine}
            label="Lower third"
            title="Move the captions to the lower third"
            disabled={locked}
            onClick={() => patchStyle({ positionY: 68 })}
          />
          <PlacementButton
            icon={AlignHorizontalJustifyCenter}
            label="Center"
            title="Center the captions horizontally"
            disabled={locked}
            onClick={() => patchStyle({ positionX: 50 })}
          />
        </div>
      </div>
      <SliderField
        label="Horizontal position"
        value={style.positionX}
        min={CAPTION_LIMITS.positionX.min}
        max={CAPTION_LIMITS.positionX.max}
        step={0.5}
        format={asPercent}
        disabled={locked}
        onChange={(positionX) => patchStyle({ positionX }, "layers-position-x")}
      />
      <SliderField
        label="Vertical position"
        value={style.positionY}
        min={CAPTION_LIMITS.positionY.min}
        max={CAPTION_LIMITS.positionY.max}
        step={0.5}
        format={asPercent}
        disabled={locked}
        onChange={(positionY) => patchStyle({ positionY }, "layers-position-y")}
      />
      <SliderField
        label="Width"
        value={style.maxWidth}
        min={CAPTION_LIMITS.maxWidth.min}
        max={CAPTION_LIMITS.maxWidth.max}
        format={asPercent}
        disabled={locked}
        onChange={(maxWidth) => patchStyle({ maxWidth }, "layers-max-width")}
      />
      <SegmentedControl
        label="Alignment"
        value={style.textAlign}
        options={ALIGN_OPTIONS}
        disabled={locked}
        onChange={(textAlign) => patchStyle({ textAlign })}
      />
      <SliderField
        label="Rotation"
        value={style.rotation}
        min={CAPTION_LIMITS.rotation.min}
        max={CAPTION_LIMITS.rotation.max}
        step={0.5}
        format={(value) => `${tidy(value)}°`}
        disabled={locked}
        onChange={(rotation) => patchStyle({ rotation }, "layers-rotation")}
      />
      <div className="space-y-1.5">
        <SliderField
          label="Opacity"
          value={style.opacity}
          min={CAPTION_LIMITS.opacity.min}
          max={CAPTION_LIMITS.opacity.max}
          step={0.01}
          format={percent}
          disabled={locked}
          onChange={(opacity) => patchStyle({ opacity }, "layers-opacity")}
        />
        <Hint>Fades the whole caption block, both boxes included.</Hint>
      </div>
      {locked ? null : (
        <p className="flex items-start gap-2 rounded-lg border border-white/[0.07] px-2.5 py-2 text-[11px] leading-4 text-zinc-500">
          <Move size={12} aria-hidden className="mt-0.5 shrink-0" />
          While this tab is open you can also drag the captions directly on the
          canvas.
        </p>
      )}
    </>
  );
}

function HighlightBoxProperties() {
  const { style, patchStyle, locked } = useStudio();
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <ColorField
          label="Box color"
          value={style.activeBackgroundColor}
          disabled={locked}
          onChange={(activeBackgroundColor) =>
            patchStyle({ activeBackgroundColor }, "layers-highlight-color")
          }
        />
        <ColorField
          label="Spoken word color"
          value={style.activeColor}
          disabled={locked}
          onChange={(activeColor) =>
            patchStyle({ activeColor }, "layers-highlight-text-color")
          }
        />
      </div>
      <SliderField
        label="Box opacity"
        value={style.activeBackgroundOpacity}
        min={CAPTION_LIMITS.activeBackgroundOpacity.min}
        max={CAPTION_LIMITS.activeBackgroundOpacity.max}
        step={0.01}
        format={percent}
        disabled={locked}
        onChange={(activeBackgroundOpacity) =>
          patchStyle({ activeBackgroundOpacity }, "layers-highlight-opacity")
        }
      />
      <Hint>
        {style.activeBackgroundOpacity > 0
          ? "The box sits behind the word being spoken and follows it along the line."
          : "The box is hidden. Raise its opacity or use the eye to show it; the spoken word keeps its own color either way."}
      </Hint>
    </>
  );
}

function LineBackgroundProperties() {
  const { style, patchStyle, locked } = useStudio();
  return (
    <>
      <ColorField
        label="Color"
        value={style.backgroundColor}
        disabled={locked}
        onChange={(backgroundColor) =>
          patchStyle({ backgroundColor }, "layers-line-color")
        }
      />
      <SliderField
        label="Opacity"
        value={style.backgroundOpacity}
        min={CAPTION_LIMITS.backgroundOpacity.min}
        max={CAPTION_LIMITS.backgroundOpacity.max}
        step={0.01}
        format={percent}
        disabled={locked}
        onChange={(backgroundOpacity) =>
          patchStyle({ backgroundOpacity }, "layers-line-opacity")
        }
      />
      <SliderField
        label="Corner radius"
        value={style.borderRadius}
        min={CAPTION_LIMITS.borderRadius.min}
        max={CAPTION_LIMITS.borderRadius.max}
        format={(value) => `${tidy(value)}px`}
        disabled={locked}
        onChange={(borderRadius) =>
          patchStyle({ borderRadius }, "layers-line-radius")
        }
      />
      <Hint>
        {style.backgroundOpacity > 0
          ? "The corner radius also rounds the highlight box."
          : "The background is hidden. Raise its opacity or use the eye to show it."}
      </Hint>
    </>
  );
}

function SafeAreaProperties({
  onChoose,
}: {
  onChoose: (zone: SafeZone) => void;
}) {
  const { preview } = useStudio();
  return (
    <>
      <SegmentedControl
        label="Platform"
        value={preview.safeZone}
        options={SAFE_ZONE_OPTIONS}
        onChange={onChoose}
      />
      <Hint>
        The shaded areas are where the app draws its own buttons and text. They
        are approximate and differ between devices, so keep a little margin. The
        guide is never exported.
      </Hint>
    </>
  );
}

function BackdropProperties({
  backdrop,
  videoUnavailable,
}: {
  /** The backdrop the canvas really shows. */
  backdrop: PreviewBackdrop;
  /** Why the source video cannot be shown, or null when it can. */
  videoUnavailable: string | null;
}) {
  const { setPreview } = useStudio();
  const name = useId();
  return (
    <>
      <fieldset>
        <legend className="mb-2 text-xs text-zinc-400">
          Behind the captions
        </legend>
        <div className="space-y-1.5">
          {BACKDROP_OPTIONS.map((option) => {
            const checked = option.value === backdrop;
            const disabled =
              option.value === "video" && videoUnavailable !== null;
            return (
              <label
                key={option.value}
                className={cn(
                  "relative flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-lime-300/70",
                  checked
                    ? "border-lime-300/40 bg-lime-300/6"
                    : "border-white/[0.07]",
                  disabled
                    ? "cursor-not-allowed"
                    : "cursor-pointer hover:border-white/15",
                )}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={name}
                  value={option.value}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => setPreview({ backdrop: option.value })}
                />
                <span
                  aria-hidden
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-md border border-white/15 text-zinc-400",
                    disabled && "opacity-40",
                  )}
                  style={option.swatch ?? undefined}
                >
                  {option.swatch ? null : <Video size={13} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-xs",
                      disabled
                        ? "text-zinc-600"
                        : checked
                          ? "text-lime-300"
                          : "text-zinc-300",
                    )}
                  >
                    {option.label}
                  </span>
                  {disabled ? (
                    <span className="mt-0.5 block text-[11px] leading-4 text-zinc-500">
                      {videoUnavailable}
                    </span>
                  ) : null}
                </span>
                {checked ? (
                  <Check
                    size={14}
                    aria-hidden
                    className="shrink-0 text-lime-300"
                  />
                ) : null}
              </label>
            );
          })}
        </div>
      </fieldset>
      <Hint>
        None of this is exported: the overlay always has a transparent
        background.
      </Hint>
    </>
  );
}

/** The "Layers" sidebar panel: what is stacked on the canvas, and where. */
export function LayersPanel() {
  const {
    project,
    ready,
    locked,
    style,
    patchStyle,
    preview,
    setPreview,
    mediaSrc,
  } = useStudio();
  const [selected, setSelected] = useState<LayerId>("text");
  const [remembered, setRemembered] = useState(INITIAL_REMEMBERED);
  const propertiesId = useId();

  if (!ready) {
    const failed = project.status === "FAILED";
    return (
      <>
        <PanelHeader
          title="Layers"
          description="Arrange what is drawn, and what only shows in the editor."
        />
        <EmptyState
          icon={<Layers3 size={18} />}
          title={
            failed ? "No layers to arrange" : "Layers come with the transcript"
          }
          description={
            failed
              ? "The transcription failed, so there are no captions to place on the canvas."
              : "Once the words are transcribed you can place the captions and show or hide each layer here."
          }
        />
      </>
    );
  }

  const videoUnavailable =
    project.mediaType !== "VIDEO"
      ? "Needs a video upload; this project is audio only."
      : mediaSrc
        ? null
        : "The uploaded video is not available right now.";
  // The canvas falls back to the transparent checkerboard when "Source video"
  // was remembered from another project but this one has no video.
  const backdrop: PreviewBackdrop =
    preview.backdrop === "video" && videoUnavailable !== null
      ? "transparent"
      : preview.backdrop;
  const backdropLabel =
    BACKDROP_OPTIONS.find((option) => option.value === backdrop)?.label ??
    "Transparent";

  const textHidden = style.opacity <= 0;
  const visible: Record<LayerId, boolean> = {
    highlight: style.activeBackgroundOpacity > 0,
    text: !textHidden,
    line: style.backgroundOpacity > 0,
    safe: preview.safeZone !== "none",
    backdrop: true,
  };

  const toggleStyleLayer = (id: StyleLayerId) => {
    const field = OPACITY_FIELD[id];
    const current = style[field];
    const patch: Partial<CaptionStyle> = {};
    if (current > 0) {
      setRemembered((previous) => ({ ...previous, [id]: current }));
      patch[field] = 0;
    } else {
      patch[field] = remembered[id];
    }
    patchStyle(patch);
  };

  const chooseSafeZone = (zone: SafeZone) => {
    // When the guide is switched off, the zone on screen is the one to bring
    // back; it may have been chosen before this panel was opened.
    const shown = zone === "none" ? preview.safeZone : zone;
    if (shown !== "none")
      setRemembered((previous) => ({ ...previous, zone: shown }));
    setPreview({ safeZone: zone });
  };

  const toggleSafeZone = () =>
    chooseSafeZone(preview.safeZone === "none" ? remembered.zone : "none");

  // Both boxes are drawn inside the caption block, so they vanish with it.
  const boxSummary = (shown: boolean, color: string, opacity: number) =>
    !shown ? (
      "Hidden"
    ) : textHidden ? (
      "Hidden with the caption text"
    ) : (
      <>
        <ColorDot color={color} />
        <span className="truncate">
          <span className="font-mono">{color}</span> · {percent(opacity)}
        </span>
      </>
    );

  const summaries: Record<LayerId, ReactNode> = {
    highlight: boxSummary(
      visible.highlight,
      style.activeBackgroundColor,
      style.activeBackgroundOpacity,
    ),
    text: textHidden ? (
      "Hidden"
    ) : (
      <span className="truncate">
        X {asPercent(style.positionX)} · Y {asPercent(style.positionY)} ·{" "}
        {percent(style.opacity)}
      </span>
    ),
    line: boxSummary(
      visible.line,
      style.backgroundColor,
      style.backgroundOpacity,
    ),
    safe: visible.safe
      ? `${SAFE_ZONE_LABELS[preview.safeZone]} (approx.)`
      : "Off",
    backdrop: backdropLabel,
  };

  const selectedLayer =
    LAYERS.find((layer) => layer.id === selected) ?? LAYERS[1];

  return (
    <>
      <PanelHeader
        title="Layers"
        description="Arrange what is drawn, and what only shows in the editor."
      />
      <Section title="Layer stack">
        <ul aria-label="Layers, top to bottom" className="space-y-1.5">
          {LAYERS.map((layer) => (
            <LayerRow
              key={layer.id}
              name={layer.name}
              icon={layer.icon}
              summary={summaries[layer.id]}
              editorOnly={layer.editorOnly}
              selected={layer.id === selected}
              dimmed={
                !visible[layer.id] ||
                (textHidden &&
                  (layer.id === "highlight" || layer.id === "line"))
              }
              controls={propertiesId}
              onSelect={() => setSelected(layer.id)}
              trailing={
                layer.id === "backdrop" ? (
                  <span
                    title="The backdrop is always shown"
                    className="relative grid size-7 shrink-0 place-items-center text-zinc-700"
                  >
                    <Lock size={13} aria-hidden />
                    <span className="sr-only">Always shown</span>
                  </span>
                ) : (
                  <IconButton
                    label={`Show ${layer.name.toLowerCase()}`}
                    active={visible[layer.id]}
                    disabled={layer.id !== "safe" && locked}
                    onClick={() => {
                      if (layer.id === "safe") toggleSafeZone();
                      else if (layer.id !== "backdrop")
                        toggleStyleLayer(layer.id);
                    }}
                  >
                    {visible[layer.id] ? (
                      <Eye size={15} />
                    ) : (
                      <EyeOff size={15} />
                    )}
                  </IconButton>
                )
              }
            />
          ))}
        </ul>
        {locked ? (
          <Hint>
            The caption layers are locked while the overlay renders. The two
            editor-only layers can still be changed.
          </Hint>
        ) : null}
      </Section>
      <div id={propertiesId}>
        {selectedLayer ? (
          <Section key={selectedLayer.id} title={selectedLayer.name}>
            {selected === "text" ? (
              <CaptionTextProperties />
            ) : selected === "highlight" ? (
              <HighlightBoxProperties />
            ) : selected === "line" ? (
              <LineBackgroundProperties />
            ) : selected === "safe" ? (
              <SafeAreaProperties onChoose={chooseSafeZone} />
            ) : (
              <BackdropProperties
                backdrop={backdrop}
                videoUnavailable={videoUnavailable}
              />
            )}
          </Section>
        ) : null}
      </div>
    </>
  );
}

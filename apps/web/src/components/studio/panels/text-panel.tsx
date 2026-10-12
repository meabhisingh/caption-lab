"use client";

import {
  CAPTION_ANIMATIONS,
  CAPTION_FONTS,
  CAPTION_LIMITS,
  CAPTION_SHADOWS,
  CAPTION_TEMPLATES,
  CAPTION_TEMPLATE_LIST,
  closestFontWeight,
  findCaptionFont,
  primaryFontName,
  sameCaptionStyle,
} from "@caption-generator/captions";
import type {
  CaptionFont,
  CaptionFontCategory,
} from "@caption-generator/captions";
import { CaptionPreview } from "@caption-generator/captions/composition";
import type {
  CaptionAnimation,
  CaptionShadow,
  CaptionStyle,
  CaptionTemplateId,
} from "@caption-generator/types";
import { Check, RotateCcw } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useStudio } from "../studio-context";
import { studioTabId } from "../tool-rail";
import {
  ColorField,
  IconButton,
  PanelHeader,
  Section,
  SegmentedControl,
  SelectField,
  SliderField,
  ToggleField,
  cn,
} from "../ui";

// ---- Templates --------------------------------------------------------------

type TemplateEntry = (typeof CAPTION_TEMPLATE_LIST)[number];

const TEMPLATE_COLUMNS = 2;
// Small enough for the widest template to fit its tile on one line.
const THUMBNAIL_SCALE = 0.22;

const matchesTemplate = (style: CaptionStyle) =>
  sameCaptionStyle(style, CAPTION_TEMPLATES[style.templateId]);

/** Where a key moves the selection in the template grid; null for other keys. */
const moveInGrid = (key: string, index: number, count: number) => {
  switch (key) {
    case "ArrowRight":
      return (index + 1) % count;
    case "ArrowLeft":
      return (index - 1 + count) % count;
    case "ArrowDown":
      return index + TEMPLATE_COLUMNS < count
        ? index + TEMPLATE_COLUMNS
        : index;
    case "ArrowUp":
      return index >= TEMPLATE_COLUMNS ? index - TEMPLATE_COLUMNS : index;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
};

function TemplateCard({
  template,
  selected,
  edited,
  disabled,
  onPick,
}: {
  template: TemplateEntry;
  selected: boolean;
  edited: boolean;
  disabled: boolean;
  onPick: (id: CaptionTemplateId) => void;
}) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className={cn(
          "overflow-hidden rounded-xl",
          selected ? "bg-lime-300/8" : "bg-white/3",
          disabled && "opacity-50",
        )}
      >
        {/* A mid grey keeps white text, dark text and both kinds of box visible. */}
        <div className="flex h-[68px] items-center justify-center overflow-hidden bg-linear-to-br from-[#5c5c69] to-[#3c3c46] px-2">
          <CaptionPreview
            style={CAPTION_TEMPLATES[template.id]}
            scale={THUMBNAIL_SCALE}
          />
        </div>
        <div className="px-2.5 pb-2 pt-1.5">
          <p className="truncate text-xs font-medium text-zinc-200">
            {template.name}
          </p>
          <p className="truncate text-[10px] leading-4 text-zinc-500">
            {template.note}
          </p>
        </div>
      </div>
      {selected ? (
        <span
          aria-hidden
          className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-lime-300 text-black"
        >
          <Check size={11} strokeWidth={3} />
        </span>
      ) : null}
      {selected && edited ? (
        <span
          aria-hidden
          className="absolute left-1.5 top-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-3 tracking-wider text-lime-300"
        >
          Edited
        </span>
      ) : null}
      {/* The button lies over the card so the preview's block elements stay outside it. */}
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={`${template.name}, ${template.note}${selected && edited ? ", edited" : ""}`}
        tabIndex={selected ? 0 : -1}
        disabled={disabled}
        onClick={() => onPick(template.id)}
        className={cn(
          "absolute inset-0 rounded-xl border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300 disabled:cursor-default",
          selected
            ? "border-lime-300"
            : "border-white/10 hover:border-white/30",
        )}
      />
    </div>
  );
}

function TemplateSection() {
  const { style, applyTemplate, locked } = useStudio();
  const edited = !matchesTemplate(style);
  const count = CAPTION_TEMPLATE_LIST.length;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const index = CAPTION_TEMPLATE_LIST.findIndex(
      (template) => template.id === style.templateId,
    );
    const next = moveInGrid(event.key, index, count);
    if (next === null) return;
    event.preventDefault();
    const target = CAPTION_TEMPLATE_LIST[next];
    if (!target || next === index) return;
    applyTemplate(target.id);
    event.currentTarget
      .querySelectorAll<HTMLElement>('[role="radio"]')
      [next]?.focus();
  };

  return (
    <Section
      title="Templates"
      action={
        <span className="font-mono text-[11px] text-zinc-600">{count}</span>
      }
    >
      <div
        role="radiogroup"
        aria-label="Caption template"
        className="grid grid-cols-2 gap-2"
        onKeyDown={onKeyDown}
      >
        {CAPTION_TEMPLATE_LIST.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            selected={template.id === style.templateId}
            edited={edited}
            disabled={locked}
            onPick={applyTemplate}
          />
        ))}
      </div>
    </Section>
  );
}

// ---- Font -------------------------------------------------------------------

type FontOption = { value: string; label: string; group?: string };

const SYSTEM_FONT_GROUP = "System fonts";
const FONT_CATEGORY_GROUPS: Record<CaptionFontCategory, string> = {
  sans: "Sans",
  display: "Display",
  serif: "Serif",
  mono: "Mono",
  handwritten: "Handwritten",
};
const FONT_GROUP_ORDER = [
  ...Object.values(FONT_CATEGORY_GROUPS),
  SYSTEM_FONT_GROUP,
];

const fontGroup = (font: CaptionFont) =>
  font.bundled ? FONT_CATEGORY_GROUPS[font.category] : SYSTEM_FONT_GROUP;

const FONT_OPTIONS: FontOption[] = CAPTION_FONTS.map((font) => ({
  value: font.family,
  label: font.label,
  group: fontGroup(font),
})).sort(
  (left, right) =>
    FONT_GROUP_ORDER.indexOf(left.group) -
    FONT_GROUP_ORDER.indexOf(right.group),
);

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extra bold",
  900: "Black",
};
// Offered for a font that is not in the registry.
const GENERIC_WEIGHTS: readonly number[] = [
  100, 200, 300, 400, 500, 600, 700, 800, 900,
];

const weightLabel = (weight: number) => {
  const name = WEIGHT_NAMES[weight];
  return name ? `${name} · ${weight}` : String(weight);
};

function Hint({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <p className={cn("text-[11px] leading-4 text-zinc-600", className)}>
      {children}
    </p>
  );
}

function FontSection() {
  const { style, patchStyle, locked } = useStudio();
  const font = findCaptionFont(style.fontFamily);

  const fontOptions: FontOption[] = font
    ? FONT_OPTIONS
    : [
        {
          value: style.fontFamily,
          label: `Current: ${primaryFontName(style.fontFamily)}`,
        },
        ...FONT_OPTIONS,
      ];

  const offeredWeights = font?.weights ?? GENERIC_WEIGHTS;
  const weights = offeredWeights.includes(style.fontWeight)
    ? offeredWeights
    : [...offeredWeights, style.fontWeight].sort((a, b) => a - b);
  const weightOptions = weights.map((weight) => ({
    value: weight,
    label: offeredWeights.includes(weight)
      ? weightLabel(weight)
      : `${weightLabel(weight)} (current)`,
  }));

  return (
    <Section title="Font">
      <SelectField
        label="Font family"
        value={style.fontFamily}
        options={fontOptions}
        disabled={locked}
        onChange={(family) => {
          const picked = findCaptionFont(family);
          patchStyle({
            fontFamily: family,
            fontWeight: picked
              ? closestFontWeight(picked, style.fontWeight)
              : style.fontWeight,
          });
        }}
      />
      <div>
        <p
          aria-hidden
          className="truncate rounded-lg border border-white/10 bg-[#17171b] px-3 py-2.5 text-[19px] leading-7 text-zinc-100"
          style={{
            fontFamily: style.fontFamily,
            fontWeight: style.fontWeight,
            fontStyle: style.italic ? "italic" : "normal",
            letterSpacing: `${style.letterSpacing}em`,
            textTransform: style.uppercase ? "uppercase" : "none",
          }}
        >
          Every word counts
        </p>
        {font?.bundled ? null : (
          <Hint className="mt-2">
            A system font is drawn by the computer that renders the export, so
            it can look different there.
          </Hint>
        )}
      </div>
      <SelectField
        label="Weight"
        value={style.fontWeight}
        options={weightOptions}
        disabled={locked || weightOptions.length < 2}
        onChange={(fontWeight) => patchStyle({ fontWeight })}
      />
      <SliderField
        label="Size"
        value={style.fontSize}
        min={CAPTION_LIMITS.fontSize.min}
        max={CAPTION_LIMITS.fontSize.max}
        format={(value) => `${Math.round(value)}px`}
        disabled={locked}
        onChange={(fontSize) => patchStyle({ fontSize }, "text-panel:fontSize")}
      />
      <SliderField
        label="Letter spacing"
        value={style.letterSpacing}
        min={CAPTION_LIMITS.letterSpacing.min}
        max={CAPTION_LIMITS.letterSpacing.max}
        step={0.005}
        format={(value) => `${Number(value.toFixed(3))}em`}
        disabled={locked}
        onChange={(letterSpacing) =>
          patchStyle({ letterSpacing }, "text-panel:letterSpacing")
        }
      />
      <ToggleField
        label="Uppercase"
        checked={style.uppercase}
        disabled={locked}
        onChange={(uppercase) => patchStyle({ uppercase })}
      />
      <ToggleField
        label="Italic"
        description={
          font && !font.italic
            ? "This font has no italic, so it is slanted instead."
            : undefined
        }
        checked={style.italic}
        disabled={locked}
        onChange={(italic) => patchStyle({ italic })}
      />
    </Section>
  );
}

// ---- Colors -----------------------------------------------------------------

const toPercent = (fraction: number) => Math.round(fraction * 100);
const formatPercent = (value: number) => `${value}%`;

// Opacity sliders of a box that is switched on stop short of zero: reaching it
// would switch the box off and take the slider away in the middle of a drag.
const boxOpacityRange = (limits: { min: number; max: number }) => ({
  min: Math.max(5, toPercent(limits.min)),
  max: toPercent(limits.max),
});

const HIGHLIGHT_BOX_OPACITY = boxOpacityRange(
  CAPTION_LIMITS.activeBackgroundOpacity,
);
const LINE_BACKGROUND_OPACITY = boxOpacityRange(
  CAPTION_LIMITS.backgroundOpacity,
);
const DIM_MAX = toPercent(1 - CAPTION_LIMITS.inactiveOpacity.min);

function Nested({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4 border-l border-white/10 pl-3">{children}</div>
  );
}

function ColorsSection() {
  const { style, patchStyle, locked } = useStudio();
  const highlightBox = style.activeBackgroundOpacity > 0;
  const lineBackground = style.backgroundOpacity > 0;

  return (
    <Section title="Colors">
      <div>
        <div className="grid grid-cols-2 gap-3">
          <ColorField
            label="Text color"
            value={style.textColor}
            disabled={locked}
            onChange={(textColor) =>
              patchStyle({ textColor }, "text-panel:textColor")
            }
          />
          <ColorField
            label="Highlight text color"
            value={style.activeColor}
            disabled={locked}
            onChange={(activeColor) =>
              patchStyle({ activeColor }, "text-panel:activeColor")
            }
          />
        </div>
        <Hint className="mt-2">The highlight is the word being spoken.</Hint>
      </div>

      <ToggleField
        label="Highlight box"
        description="A box behind the word being spoken."
        checked={highlightBox}
        disabled={locked}
        onChange={(on) => patchStyle({ activeBackgroundOpacity: on ? 1 : 0 })}
      />
      {highlightBox ? (
        <Nested>
          <ColorField
            label="Highlight box color"
            value={style.activeBackgroundColor}
            disabled={locked}
            onChange={(activeBackgroundColor) =>
              patchStyle(
                { activeBackgroundColor },
                "text-panel:activeBackgroundColor",
              )
            }
          />
          <SliderField
            label="Highlight box opacity"
            value={toPercent(style.activeBackgroundOpacity)}
            min={HIGHLIGHT_BOX_OPACITY.min}
            max={HIGHLIGHT_BOX_OPACITY.max}
            format={formatPercent}
            disabled={locked}
            onChange={(percent) =>
              patchStyle(
                { activeBackgroundOpacity: percent / 100 },
                "text-panel:activeBackgroundOpacity",
              )
            }
          />
        </Nested>
      ) : null}

      <ToggleField
        label="Line background"
        description="A box behind the whole caption line."
        checked={lineBackground}
        disabled={locked}
        onChange={(on) => patchStyle({ backgroundOpacity: on ? 0.8 : 0 })}
      />
      {lineBackground ? (
        <Nested>
          <ColorField
            label="Line background color"
            value={style.backgroundColor}
            disabled={locked}
            onChange={(backgroundColor) =>
              patchStyle({ backgroundColor }, "text-panel:backgroundColor")
            }
          />
          <SliderField
            label="Line background opacity"
            value={toPercent(style.backgroundOpacity)}
            min={LINE_BACKGROUND_OPACITY.min}
            max={LINE_BACKGROUND_OPACITY.max}
            format={formatPercent}
            disabled={locked}
            onChange={(percent) =>
              patchStyle(
                { backgroundOpacity: percent / 100 },
                "text-panel:backgroundOpacity",
              )
            }
          />
        </Nested>
      ) : null}

      <ColorField
        label="Outline color"
        value={style.strokeColor}
        disabled={locked}
        onChange={(strokeColor) =>
          patchStyle({ strokeColor }, "text-panel:strokeColor")
        }
      />
      <SliderField
        label="Outline width"
        value={style.strokeWidth}
        min={CAPTION_LIMITS.strokeWidth.min}
        max={CAPTION_LIMITS.strokeWidth.max}
        step={0.5}
        format={(value) => `${value}px`}
        disabled={locked}
        onChange={(strokeWidth) =>
          patchStyle({ strokeWidth }, "text-panel:strokeWidth")
        }
      />

      {/* Shown as how much the other words fade, the inverse of their opacity. */}
      <SliderField
        label="Dim other words"
        value={toPercent(1 - style.inactiveOpacity)}
        min={toPercent(1 - CAPTION_LIMITS.inactiveOpacity.max)}
        max={DIM_MAX}
        format={formatPercent}
        disabled={locked}
        onChange={(percent) =>
          patchStyle(
            { inactiveOpacity: (100 - percent) / 100 },
            "text-panel:inactiveOpacity",
          )
        }
      />
    </Section>
  );
}

// ---- Shape and motion -------------------------------------------------------

const SHADOW_COPY: Record<CaptionShadow, { label: string; title: string }> = {
  none: { label: "None", title: "No shadow" },
  soft: { label: "Soft", title: "A blurred shadow below the text" },
  hard: {
    label: "Hard",
    title: "A solid offset shadow in the outline color",
  },
  glow: { label: "Glow", title: "The highlighted word glows in its color" },
};
const SHADOW_OPTIONS = CAPTION_SHADOWS.map((value) => ({
  value,
  ...SHADOW_COPY[value],
}));

const ANIMATION_COPY: Record<
  CaptionAnimation,
  { label: string; title: string }
> = {
  pop: { label: "Pop", title: "Each word pops up in size as it is spoken" },
  rise: { label: "Rise", title: "Each word rises into place as it is spoken" },
  none: { label: "None", title: "Words change color without moving" },
};
const ANIMATION_OPTIONS = CAPTION_ANIMATIONS.map((value) => ({
  value,
  ...ANIMATION_COPY[value],
}));

function ShapeSection() {
  const { style, patchStyle, locked } = useStudio();
  const hasBox =
    style.activeBackgroundOpacity > 0 || style.backgroundOpacity > 0;
  return (
    <Section title="Shape and motion">
      <div>
        <SliderField
          label="Corner radius"
          value={style.borderRadius}
          min={CAPTION_LIMITS.borderRadius.min}
          max={CAPTION_LIMITS.borderRadius.max}
          format={(value) => `${Math.round(value)}px`}
          disabled={locked}
          onChange={(borderRadius) =>
            patchStyle({ borderRadius }, "text-panel:borderRadius")
          }
        />
        {hasBox ? null : (
          <Hint className="mt-2">
            Rounds the highlight box and the line background. Turn one on under
            Colors to see it.
          </Hint>
        )}
      </div>
      <div>
        <SegmentedControl
          label="Shadow"
          value={style.shadow}
          options={SHADOW_OPTIONS}
          disabled={locked}
          onChange={(shadow) => patchStyle({ shadow })}
        />
        {/* A boxed word is drawn without a shadow, so Glow would seem broken. */}
        {style.shadow === "glow" && style.activeBackgroundOpacity > 0 ? (
          <Hint className="mt-2">
            The highlight box replaces the glow. Turn the box off under Colors
            to see it.
          </Hint>
        ) : null}
      </div>
      <SegmentedControl
        label="Animation"
        value={style.animation}
        options={ANIMATION_OPTIONS}
        disabled={locked}
        onChange={(animation) => patchStyle({ animation })}
      />
    </Section>
  );
}

// ---- Layout -----------------------------------------------------------------

function LayoutSection() {
  const { style, patchStyle, locked, setActiveTab } = useStudio();
  return (
    <Section title="Layout">
      <SliderField
        label="Words per line"
        value={style.maxWords}
        min={CAPTION_LIMITS.maxWords.min}
        max={CAPTION_LIMITS.maxWords.max}
        disabled={locked}
        onChange={(maxWords) => patchStyle({ maxWords }, "text-panel:maxWords")}
      />
      <SliderField
        label="Vertical position"
        value={style.positionY}
        min={CAPTION_LIMITS.positionY.min}
        max={CAPTION_LIMITS.positionY.max}
        step={0.5}
        format={(value) => `${Number(value.toFixed(1))}%`}
        disabled={locked}
        onChange={(positionY) =>
          patchStyle({ positionY }, "text-panel:positionY")
        }
      />
      <Hint>
        Horizontal position, width, alignment and rotation are in the{" "}
        <button
          type="button"
          onClick={() => {
            setActiveTab("layers");
            // This panel is hidden next; the focus goes where the user went.
            document.getElementById(studioTabId("layers"))?.focus();
          }}
          className="rounded-sm text-zinc-400 underline underline-offset-2 hover:text-lime-300"
        >
          Layers tab
        </button>
        .
      </Hint>
    </Section>
  );
}

// ---- Panel ------------------------------------------------------------------

/** The "Text" sidebar panel: caption templates and every style control. */
export function TextPanel() {
  const { project, style, applyTemplate, ready, locked } = useStudio();
  const untouched = matchesTemplate(style);

  return (
    <div>
      <PanelHeader
        title="Caption style"
        description="Pick a look, then make it yours."
        action={
          <IconButton
            label="Reset to the template's defaults"
            disabled={locked || untouched}
            onClick={() => applyTemplate(style.templateId)}
          >
            <RotateCcw size={15} />
          </IconButton>
        }
      />
      {!ready && project.status !== "FAILED" ? (
        <p className="border-b border-white/[0.07] px-5 py-3 text-[11px] leading-4 text-zinc-500">
          Your style shows on the canvas as soon as the transcript is ready.
        </p>
      ) : null}
      <TemplateSection />
      <FontSection />
      <ColorsSection />
      <ShapeSection />
      <LayoutSection />
    </div>
  );
}

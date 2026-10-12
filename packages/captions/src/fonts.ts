export type CaptionFontCategory =
  "display" | "sans" | "serif" | "mono" | "handwritten";

export type CaptionFont = {
  id: string;
  label: string;
  /** The value stored in `CaptionStyle.fontFamily`. */
  family: string;
  category: CaptionFontCategory;
  /** Weights the font draws itself; anything else is faked by the browser. */
  weights: readonly number[];
  /** Whether a real italic face is available. */
  italic: boolean;
  /**
   * Bundled fonts ship with the app (see font-faces.ts) and render the same in
   * the preview and in every export. System fonts depend on the machine.
   */
  bundled: boolean;
};

export const CAPTION_FONTS: readonly CaptionFont[] = [
  {
    id: "montserrat",
    label: "Montserrat",
    family: '"Montserrat Variable", Montserrat, Arial, sans-serif',
    category: "sans",
    weights: [400, 500, 600, 700, 800, 900],
    italic: true,
    bundled: true,
  },
  {
    id: "poppins",
    label: "Poppins",
    family: "Poppins, Arial, sans-serif",
    category: "sans",
    weights: [500, 600, 700, 800, 900],
    italic: false,
    bundled: true,
  },
  {
    id: "inter",
    label: "Inter",
    family: '"Inter Variable", Inter, Arial, sans-serif',
    category: "sans",
    weights: [400, 500, 600, 700, 800, 900],
    italic: true,
    bundled: true,
  },
  {
    id: "fredoka",
    label: "Fredoka",
    family: '"Fredoka Variable", Fredoka, "Trebuchet MS", sans-serif',
    category: "sans",
    weights: [400, 500, 600, 700],
    italic: false,
    bundled: true,
  },
  {
    id: "anton",
    label: "Anton",
    family: 'Anton, Impact, "Arial Narrow", sans-serif',
    category: "display",
    weights: [400],
    italic: false,
    bundled: true,
  },
  {
    id: "bebas-neue",
    label: "Bebas Neue",
    family: '"Bebas Neue", Impact, sans-serif',
    category: "display",
    weights: [400],
    italic: false,
    bundled: true,
  },
  {
    id: "archivo-black",
    label: "Archivo Black",
    family: '"Archivo Black", "Arial Black", sans-serif',
    category: "display",
    weights: [400],
    italic: false,
    bundled: true,
  },
  {
    id: "oswald",
    label: "Oswald",
    family: '"Oswald Variable", Oswald, "Arial Narrow", sans-serif',
    category: "display",
    weights: [400, 500, 600, 700],
    italic: false,
    bundled: true,
  },
  {
    id: "bangers",
    label: "Bangers",
    family: "Bangers, Impact, fantasy",
    category: "display",
    weights: [400],
    italic: false,
    bundled: true,
  },
  {
    id: "playfair-display",
    label: "Playfair Display",
    family: '"Playfair Display Variable", "Playfair Display", Georgia, serif',
    category: "serif",
    weights: [400, 500, 600, 700, 800, 900],
    italic: true,
    bundled: true,
  },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    family: '"JetBrains Mono Variable", "JetBrains Mono", Consolas, monospace',
    category: "mono",
    weights: [400, 500, 600, 700, 800],
    italic: true,
    bundled: true,
  },
  {
    id: "permanent-marker",
    label: "Permanent Marker",
    family: '"Permanent Marker", "Comic Sans MS", cursive',
    category: "handwritten",
    weights: [400],
    italic: false,
    bundled: true,
  },
  {
    id: "arial-black",
    label: "Arial Black",
    family: "Arial Black, Arial, sans-serif",
    category: "display",
    weights: [900],
    italic: false,
    bundled: false,
  },
  {
    id: "arial",
    label: "Arial",
    family: "Arial, sans-serif",
    category: "sans",
    weights: [400, 700],
    italic: true,
    bundled: false,
  },
  {
    id: "impact",
    label: "Impact",
    family: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif',
    category: "display",
    weights: [400],
    italic: false,
    bundled: false,
  },
  {
    id: "georgia",
    label: "Georgia",
    family: "Georgia, serif",
    category: "serif",
    weights: [400, 700],
    italic: true,
    bundled: false,
  },
  {
    id: "times-new-roman",
    label: "Times New Roman",
    family: '"Times New Roman", Times, serif',
    category: "serif",
    weights: [400, 700],
    italic: true,
    bundled: false,
  },
  {
    id: "courier-new",
    label: "Courier New",
    family: '"Courier New", Courier, monospace',
    category: "mono",
    weights: [400, 700],
    italic: true,
    bundled: false,
  },
  {
    id: "comic-sans",
    label: "Comic Sans",
    family: '"Comic Sans MS", "Comic Sans", cursive',
    category: "handwritten",
    weights: [400, 700],
    italic: false,
    bundled: false,
  },
];

export const findCaptionFont = (family: string) =>
  CAPTION_FONTS.find((font) => font.family === family) ?? null;

/** The first family name in a CSS font stack, for showing an unknown font. */
export const primaryFontName = (family: string) =>
  (family.split(",")[0] ?? family).trim().replace(/^["']|["']$/g, "") ||
  "Custom font";

/** The weight a font can draw that is nearest to the requested one. */
export const closestFontWeight = (font: CaptionFont, weight: number) =>
  font.weights.reduce(
    (best, candidate) =>
      Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best,
    font.weights[0] ?? 400,
  );

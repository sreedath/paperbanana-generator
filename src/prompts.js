// Prompt templates ported from PaperBanana (llmsresearch/paperbanana)
// for single-shot Gemini image generation.

const VISUALIZER_PREFIX = `You are an expert scientific diagram illustrator. Generate a high-quality, publication-ready academic illustration based on the description below. Do not include a figure title or "Figure 1:" caption text inside the image.

CRITICAL: All text labels must be rendered in clear, readable English. Use the EXACT label names specified in the description. Do not generate garbled, misspelled, or non-English text. Never render hex codes, pixel dimensions, or CSS-like specifications as visible text.`;

// ---------- Style presets ----------
// `default` keeps the classic PaperBanana pastel academic look. Any other
// preset replaces the style block below. Presets are pure English guidance —
// no hex codes or pixel dims, so Gemini doesn't render them as text.

const STYLES = {
  default: {
    label: "Default (PaperBanana pastel academic)",
    block: `## Academic Illustration Style Guidelines

### Color Philosophy
- Use soft, muted, pastel tones — never fully saturated primaries.
- Limit to 3–5 primary hues per diagram.
- Each distinct color maps to a distinct concept or phase.
- Use darker shades of the same hue for borders (not black).
- Describe colors in natural language ("soft sky blue", "warm peach", "light sage green").

### Typography
- Clean sans-serif fonts for all labels.
- Visual hierarchy through size and weight: larger bold for titles, medium bold for components, smaller for annotations.
- All text must be clear, readable English.

### Layout
- Consistent spacing between elements.
- Clear flow direction (left-to-right or top-to-bottom).
- Balanced composition with visual weight evenly distributed.
- Use whitespace intentionally to separate phases and groups.

### Visual Elements
- Rounded rectangles with soft pastel fills for components.
- Solid arrows with dark gray color for primary data flow.
- Dashed arrows for optional or conditional connections.
- Semi-transparent colored backgrounds for grouping regions.
- No gradients, no 3D effects, no drop shadows, no decorative borders.
- Pure white or very light pastel background.`,
  },
  "research-paper": {
    label: "Research paper (camera-ready)",
    block: `## Style: Camera-ready Research Paper Figure

### Overall Aesthetic
- NeurIPS / ICML / CVPR camera-ready convention.
- Restrained, precise, and legible at small print size.
- Prioritize clarity over visual flair — this must read cleanly when reproduced in grayscale.

### Color Philosophy
- Predominantly grayscale with at most two restrained accent colors (e.g., dusty blue and muted rust).
- Fill interiors are off-white or very light neutral grays.
- Strokes are dark gray, not pure black.

### Typography
- Clean serif or sans-serif matching modern ML paper figures (think Computer Modern or a neutral grotesque).
- Tight, geometric label placement.
- Math notation rendered correctly (Greek letters, subscripts, superscripts).

### Visual Elements
- Thin, precise strokes (not chunky).
- Sharp rectangles or subtly rounded corners — no playful shapes.
- Solid arrows for primary flow, dashed for optional.
- Legends and annotations are minimal and placed for readability.
- No gradients, no shadows, no decorative backgrounds.
- Pure white background.`,
  },
  presentation: {
    label: "Presentation slide",
    block: `## Style: Conference Presentation Slide

### Overall Aesthetic
- Built to be read across a room. Larger components, bolder strokes, higher contrast than a paper figure.

### Color Philosophy
- Vivid but tasteful palette — saturated but not neon. Teal, coral, amber, deep violet are good anchors.
- Use color to draw the eye to the key concept first.

### Typography
- Clean bold sans-serif. Labels must be legible at slide-projection size.
- Clear visual hierarchy — titles of sub-regions should pop.

### Visual Elements
- Larger rounded rectangles with confident colored fills.
- Thick arrows (but still tasteful) with clear direction.
- Group containers with soft-colored backgrounds.
- Subtle shadow or glow is acceptable if it aids separation, but never ornate.
- Light neutral background (pure white or very soft cream).`,
  },
  minimalist: {
    label: "Minimalist line-art",
    block: `## Style: Minimalist Line Art

### Overall Aesthetic
- Inspired by editorial/tech-blog hero illustrations: spare, confident, almost monochrome.

### Color Philosophy
- Monochrome or duotone: a single accent color plus dark gray strokes.
- Fills are usually empty (white interiors) or very faint wash.

### Typography
- Small, clean sans-serif labels. Sparing.

### Visual Elements
- Thin precise strokes. Geometric shapes.
- Plenty of whitespace. Do not pack the canvas.
- No gradients, shadows, or texture.
- Pure white background.`,
  },
  "hand-drawn": {
    label: "Hand-drawn whiteboard",
    block: `## Style: Hand-drawn Whiteboard Sketch

### Overall Aesthetic
- Looks like a thoughtful researcher sketched this on a whiteboard during a lab meeting — approachable, explanatory, slightly informal.

### Color Philosophy
- Marker-style colors: soft navy, brick red, forest green, mustard yellow — desaturated.
- Fills are slightly uneven, as if from a real marker.

### Typography
- Hand-lettered look — neat, human, but readable.

### Visual Elements
- Irregular but intentional strokes; boxes have slightly wobbly edges.
- Arrows are drawn, not vectorial.
- Small doodles or icons are welcome where they aid meaning.
- Background is plain white or very faint cream, mimicking paper or whiteboard.`,
  },
  dark: {
    label: "Dark mode (slide/keynote)",
    block: `## Style: Dark Mode Keynote

### Overall Aesthetic
- High-contrast dark background figure, like a Keynote dark-theme slide.

### Color Philosophy
- Background is deep charcoal or near-black.
- Accent colors are saturated but tasteful: teal, magenta, amber.
- Text is off-white.

### Typography
- Bold sans-serif, slightly wider letterspacing for legibility on dark.

### Visual Elements
- Rounded rectangles with subtle colored fills and bright borders.
- Glowing or subtly-lit arrows for flow.
- Keep contrast high; avoid muddy dark-on-dark.
- No gradients more elaborate than a subtle glow.`,
  },
};

// ---------- Color theme overrides ----------
// These append a palette-override block after the style guidelines. The swatch
// array is only for the UI — the model sees the natural-language block.
// `default` = no override (keeps whatever the style preset decided).

const COLOR_THEMES = {
  default: {
    label: "Default",
    swatch: [],
    block: "",
  },
  ocean: {
    label: "Ocean",
    swatch: ["#cfe4f5", "#8ab7d4", "#f2e6cf", "#2f4a68"],
    block: `## Palette override: Ocean
- Primary hues: soft powder blue, muted seafoam, sand beige, deep slate navy for emphasis.
- Background: off-white or pale sand.
- Use navy only for key accents and arrow heads.`,
  },
  sunset: {
    label: "Sunset",
    swatch: ["#f8c9a4", "#f08a80", "#f5d98a", "#8e4a5c"],
    block: `## Palette override: Sunset
- Primary hues: warm peach, dusty coral, soft amber, muted rose, deep plum for emphasis.
- Background: pale cream.
- Use plum sparingly as the high-contrast anchor.`,
  },
  forest: {
    label: "Forest",
    swatch: ["#c9d8b8", "#8ba276", "#c97d5a", "#f3ead8"],
    block: `## Palette override: Forest
- Primary hues: sage green, moss, warm terracotta, cream, deep forest green for emphasis.
- Background: parchment cream.
- Calm natural feel; avoid vivid saturation.`,
  },
  lavender: {
    label: "Lavender",
    swatch: ["#e0d4f0", "#b9a5d4", "#f5c9d4", "#5b4673"],
    block: `## Palette override: Lavender
- Primary hues: pale lavender, dusty mauve, blush pink, silver-grey, deep violet for emphasis.
- Background: off-white with the faintest cool tint.
- Keep it airy and quiet.`,
  },
  nordic: {
    label: "Nordic",
    swatch: ["#e3ecf1", "#a9c0cf", "#d8c2b8", "#3d5263"],
    block: `## Palette override: Nordic
- Primary hues: icy pale blue, slate grey-blue, dusty rose, warm stone, deep charcoal blue for emphasis.
- Background: crisp snow-white.
- Cool restrained palette; use rose as a single warm accent.`,
  },
  earth: {
    label: "Earth tones",
    swatch: ["#e2c58a", "#a07f4c", "#7a3b1f", "#d8c3a1"],
    block: `## Palette override: Earth tones
- Primary hues: warm ochre, olive, umber brown, sandstone, deep walnut for emphasis.
- Background: soft oatmeal beige.
- Grounded earthy feel with muted saturation.`,
  },
  berry: {
    label: "Berry",
    swatch: ["#e59bb3", "#b44a6b", "#f2d4c6", "#5b2a3c"],
    block: `## Palette override: Berry
- Primary hues: dusty rose, raspberry, pale peach, muted plum, deep wine for emphasis.
- Background: cream.
- Romantic editorial feel, still restrained.`,
  },
  mint: {
    label: "Mint fresh",
    swatch: ["#c9ecd8", "#8cc6b0", "#f0ebd8", "#2d5e5b"],
    block: `## Palette override: Mint fresh
- Primary hues: pale mint, soft seafoam, warm cream, sage, deep teal for emphasis.
- Background: frosted white.
- Clean, light, breezy.`,
  },
  autumn: {
    label: "Autumn",
    swatch: ["#e4a76b", "#c0553a", "#d9b65d", "#5a2f1f"],
    block: `## Palette override: Autumn
- Primary hues: burnt orange, rust red, goldenrod, olive, deep mahogany for emphasis.
- Background: warm cream.
- Warm and rich; still use muted tones, not neon.`,
  },
  candy: {
    label: "Candy pastels",
    swatch: ["#f9cfe0", "#c9e0f5", "#fbf1c2", "#c9f0d6"],
    block: `## Palette override: Candy pastels
- Primary hues: cotton-candy pink, baby blue, lemon cream, pistachio mint, dusty lavender for emphasis.
- Background: pure white.
- Playful but tidy — strictly pastel, never saturated.`,
  },
  "mono-blue": {
    label: "Mono blue",
    swatch: ["#dbe6f0", "#8fb0cc", "#4e749a", "#1c3554"],
    block: `## Palette override: Monochrome blue
- One hue family only: from palest powder blue to deep navy.
- Use lightness to distinguish components — no other colors, no color accents.
- Background: off-white.`,
  },
  "mono-gray": {
    label: "Mono grayscale",
    swatch: ["#ececec", "#b8b8b8", "#6b6b6b", "#2a2a2a"],
    block: `## Palette override: Monochrome grayscale
- Grayscale only. Very light gray, mid gray, dark gray, near-black for emphasis.
- No color at all, including no accent.
- Background: pure white. Prioritizes legibility when the figure is reproduced in print.`,
  },
};

const DEFAULT_COLOR_THEME = "default";

// ---------- Text density modifiers ----------
// Appended to the prompt after the style block.

const TEXT_DENSITIES = {
  standard: {
    label: "Standard",
    block: "",
  },
  minimal: {
    label: "Minimal text",
    block: `## Text Density: MINIMAL
- Use only short component labels (1–3 words each).
- Omit sub-captions, formulas, footnotes, or long annotations.
- Let the visual structure carry the meaning.
- If the description mentions extensive annotations, show them visually (icons, color) instead of rendering them as text.`,
  },
  light: {
    label: "Light (few labels + brief captions)",
    block: `## Text Density: LIGHT
- Short component labels only.
- One brief caption under each major section if helpful.
- No inline formulas or long sentences inside the diagram.`,
  },
  dense: {
    label: "Dense (full annotations + math)",
    block: `## Text Density: DENSE
- Include all component labels.
- Add concise sub-annotations beneath key components (one short phrase each).
- Render mathematical notation where relevant (e.g., softmax, attention equations, loss terms).
- Include small legend blocks if multiple colors/line styles carry meaning.
- Keep every piece of text crisply legible; prefer many small labels over a few crowded ones.`,
  },
};

const DEFAULT_STYLE = "default";
const DEFAULT_TEXT_DENSITY = "standard";

/**
 * Build the final single-shot image-generation prompt.
 * @param {string} userDescription
 * @param {object} [options]
 * @param {keyof STYLES} [options.style]
 * @param {keyof TEXT_DENSITIES} [options.textDensity]
 * @param {keyof COLOR_THEMES} [options.colorTheme]
 * @returns {string}
 */
function buildImagePrompt(userDescription, options = {}) {
  const trimmed = String(userDescription || "").trim();
  const styleKey = STYLES[options.style] ? options.style : DEFAULT_STYLE;
  const densityKey = TEXT_DENSITIES[options.textDensity] ? options.textDensity : DEFAULT_TEXT_DENSITY;
  const themeKey = COLOR_THEMES[options.colorTheme] ? options.colorTheme : DEFAULT_COLOR_THEME;

  const sections = [VISUALIZER_PREFIX, STYLES[styleKey].block];
  if (COLOR_THEMES[themeKey].block) sections.push(COLOR_THEMES[themeKey].block);
  if (TEXT_DENSITIES[densityKey].block) sections.push(TEXT_DENSITIES[densityKey].block);
  sections.push("## Diagram Description\n" + trimmed);

  return sections.join("\n\n");
}

function listStyles() {
  return Object.entries(STYLES).map(([value, { label }]) => ({ value, label }));
}
function listTextDensities() {
  return Object.entries(TEXT_DENSITIES).map(([value, { label }]) => ({ value, label }));
}
function listColorThemes() {
  return Object.entries(COLOR_THEMES).map(([value, { label, swatch }]) => ({ value, label, swatch }));
}

module.exports = {
  buildImagePrompt,
  listStyles,
  listTextDensities,
  listColorThemes,
  STYLES,
  TEXT_DENSITIES,
  COLOR_THEMES,
  DEFAULT_STYLE,
  DEFAULT_TEXT_DENSITY,
  DEFAULT_COLOR_THEME,
};

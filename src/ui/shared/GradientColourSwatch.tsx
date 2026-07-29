export interface GradientColourSwatchProps {
  colour: string;
}

const SWATCH_WIDTH_PX = 32;
const SWATCH_HEIGHT_PX = 8;

/**
 * A short, thick coloured line sample — resembling the route/elevation-
 * chart line it represents, rather than a small square swatch. Width,
 * height, background and border are all set inline rather than via a CSS
 * class: this project's Vitest environment never loads index.css
 * (`test: { css: false }` in vite.config.ts), and a prior version of this
 * swatch relied on a class name with no matching CSS rule anywhere,
 * rendering as an invisible 0×0 element in production too — inline style
 * is what actually guarantees the colour has something to paint,
 * independent of stylesheet load order. A border is applied to every
 * swatch unconditionally (not just visually light ones) so it always
 * stays bounded against the panel background in both light and dark
 * theme, without needing per-colour luminance detection. Purely
 * decorative (`aria-hidden`): the caller always renders an adjacent text
 * label that carries the actual accessible, colour-independent meaning.
 */
export function GradientColourSwatch({ colour }: GradientColourSwatchProps) {
  return (
    <span
      aria-hidden="true"
      className="gradient-colour-swatch"
      style={{
        display: "inline-block",
        width: SWATCH_WIDTH_PX,
        height: SWATCH_HEIGHT_PX,
        flexShrink: 0,
        backgroundColor: colour,
        border: "1px solid var(--colour-border)",
        borderRadius: 3,
      }}
    />
  );
}

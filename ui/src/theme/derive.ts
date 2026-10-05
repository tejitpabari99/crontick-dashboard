/**
 * TS mirror of the CSS calc() derivation in tokens.css / themes.css.
 * Used by tests (AA contrast); the app itself uses CSS only.
 */
export type Hsl = readonly [h: number, s: number, l: number];

export interface Preset {
  dir: 1 | -1;
  bg: Hsl;
  primary: Hsl;
  positive: Hsl;
  negative: Hsl;
  contrast: number;
  textSat: number;
}

export const PRESETS: Record<'dark' | 'light', Preset> = {
  dark: { dir: 1, bg: [230, 15, 14], primary: [256, 85, 72], positive: [150, 55, 52], negative: [4, 75, 62], contrast: 1.1, textSat: 1 },
  light: { dir: -1, bg: [220, 23, 96], primary: [220, 85, 50], positive: [150, 60, 36], negative: [4, 70, 48], contrast: 1, textSat: 1 },
};

export interface Derived {
  bg: Hsl;
  surface1: Hsl;
  surface2: Hsl;
  border: Hsl;
  text: Hsl;
  textMuted: Hsl;
  primary: Hsl;
}

export function derive(p: Preset): Derived {
  const [h, s, l] = p.bg;
  const step = (n: number): Hsl => [h, s, l + p.dir * n * p.contrast];
  const textS = s * p.textSat;
  return {
    bg: p.bg,
    surface1: step(3),
    surface2: step(6),
    border: step(12),
    text: [h, textS, 52 + p.dir * 40],
    textMuted: [h, textS, 52 + p.dir * 17],
    primary: p.primary,
  };
}

export function hslToRgb([h, s, l]: Hsl): [number, number, number] {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

export function luminance(c: Hsl): number {
  const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hslToRgb(c).map(lin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: Hsl, b: Hsl): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

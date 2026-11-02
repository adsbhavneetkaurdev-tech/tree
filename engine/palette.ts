export interface OrnamentColor {
  key: string;
  base: string;
  light: string;
  dark: string;
  glow: [number, number, number];
  weight: number;
}

/** Deep evergreen, warm gold, champagne, white and restrained red. */
export const ORNAMENT_COLORS: OrnamentColor[] = [
  { key: "gold", base: "#d9a94e", light: "#fff0c4", dark: "#6e4810", glow: [255, 204, 120], weight: 30 },
  { key: "champagne", base: "#e9d3a0", light: "#fffaf0", dark: "#8a7044", glow: [255, 232, 186], weight: 22 },
  { key: "ivory", base: "#efe9dc", light: "#ffffff", dark: "#8f8a80", glow: [255, 246, 228], weight: 18 },
  { key: "red", base: "#9e2731", light: "#ec8d93", dark: "#3c070d", glow: [255, 120, 110], weight: 16 },
  { key: "frost", base: "#c4d8cf", light: "#ffffff", dark: "#4d6a5e", glow: [220, 245, 235], weight: 8 },
  { key: "rosegold", base: "#cf9474", light: "#ffe2cf", dark: "#653420", glow: [255, 190, 160], weight: 6 },
];

export const LIGHT_COLORS: { rgb: [number, number, number]; weight: number }[] = [
  { rgb: [255, 206, 130], weight: 62 }, // warm white
  { rgb: [255, 244, 222], weight: 22 }, // soft white
  { rgb: [255, 186, 92], weight: 12 }, // amber
  { rgb: [255, 110, 100], weight: 4 }, // rare red
];

export function pickWeighted<T extends { weight: number }>(items: T[], r: number): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let x = r * total;
  for (const it of items) {
    x -= it.weight;
    if (x <= 0) return it;
  }
  return items[items.length - 1];
}

export const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

import type { PlanDay, TaskDay } from "./types";

export type DayKey = TaskDay;

export const dayClassMap: Record<DayKey | "הכל", string> = {
  "הכל": "day-all",
  "לפני": "day-before",
  "חמישי": "day-thu",
  "שישי": "day-fri",
  "שבת": "day-sat",
  "ראשון": "day-sun",
};

export const dayOrder: readonly DayKey[] = [
  "לפני",
  "חמישי",
  "שישי",
  "שבת",
  "ראשון",
];

export const planDayOrder: readonly PlanDay[] = ["חמישי", "שישי", "שבת", "ראשון"];

// Chronological rainbow: warm → cool as the trip progresses.
// Reads as a story: pink anticipation → orange grill → gold Friday →
// green Shabbat → blue Sunday wrap-up.
const DAY_HUE: Record<DayKey | "הכל", number> = {
  "הכל": 280,
  "לפני": 340,
  "חמישי": 22,
  "שישי": 50,
  "שבת": 140,
  "ראשון": 218,
};

export function dayHue(day: DayKey | "הכל"): number {
  return DAY_HUE[day];
}

export type PersonColor = {
  bg: string;
  border: string;
  text: string;
  hue: number;
};

// Curated rainbow palette — 10 maximally-distinct hues across the spectrum.
// Picked so every adjacent pair reads as a different color, and the set
// as a whole spans red → orange → yellow → green → teal → blue → purple → pink.
const RAINBOW_HUES: readonly number[] = [
  0,   // red
  28,  // orange
  50,  // gold
  90,  // chartreuse
  140, // green
  170, // teal
  200, // sky blue
  240, // indigo
  278, // violet
  318, // magenta-pink
];

export function hueAtIndex(index: number): number {
  const i = ((index % RAINBOW_HUES.length) + RAINBOW_HUES.length) % RAINBOW_HUES.length;
  return RAINBOW_HUES[i];
}

export function makePersonColor(hue: number): PersonColor {
  return {
    hue,
    bg: `hsl(${hue} 68% 24% / 0.88)`,
    border: `hsl(${hue} 75% 56% / 0.7)`,
    text: `hsl(${hue} 88% 85%)`,
  };
}

// Fallback hash-based color (used only when no canonical index is available).
function djb2(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return Math.abs(hash);
}

export function personColor(name: string): PersonColor {
  const trimmed = name.trim() || "anon";
  const phi = 0.6180339887498949;
  const t = ((djb2(trimmed) * phi) % 1 + 1) % 1;
  return makePersonColor(Math.round(t * 360));
}

export function progressColor(progress: number): {
  start: string;
  end: string;
  glow: string;
} {
  const clamped = Math.max(0, Math.min(100, progress));
  const hue = Math.round((clamped / 100) * 132);
  return {
    start: `hsl(0 70% 56%)`,
    end: `hsl(${hue} 72% 55%)`,
    glow: `hsl(${hue} 75% 55% / 0.45)`,
  };
}

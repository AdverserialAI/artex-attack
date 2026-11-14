/**
 * Main functions/types:
 *   - fontRegistry / FontKey: registry of available fonts (key → next/font instance)
 *   - fontKeys: all valid font keys (for validating persisted values)
 *   - fontVars: list of CSS variable names for all fonts
 *   - fontOptions: font dropdown options (label + variable)
 */
import { GeistMono } from "geist/font/mono";
import { GeistPixelSquare } from "geist/font/pixel";
import { GeistSans } from "geist/font/sans";

export const fontRegistry = {
  geist: { label: "Geist", font: GeistSans },
  geistMono: { label: "Geist Mono", font: GeistMono },
  geistPixelSquare: { label: "Geist Pixel Square", font: GeistPixelSquare },
} as const;

export type FontKey = keyof typeof fontRegistry;

export const fontKeys = Object.keys(fontRegistry) as FontKey[];

export const fontVars = (Object.values(fontRegistry) as Array<(typeof fontRegistry)[FontKey]>)
  .map((f) => f.font.variable)
  .join(" ");

export const fontOptions = (
  Object.entries(fontRegistry) as [FontKey, { label: string; font: { variable: string } }][]
).map(([key, f]) => ({
  key,
  label: f.label,
  variable: f.font.variable,
}));

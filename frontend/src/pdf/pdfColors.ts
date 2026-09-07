import type { Category } from "../lib/types";

/**
 * The exported PDF always renders in light mode, regardless of the viewer's
 * OS theme — a deliberate, standard convention for an exported document, not
 * an oversight. react-pdf understands neither CSS custom properties nor
 * color-mix(), so these mirror tokens.css's :root (light) block as literal
 * hex values. Keep in sync by hand if that block changes.
 */
export const PDF_COLORS = {
  surfacePage: "#f9f9f7",
  surface1: "#fcfcfb",
  surface2: "#f2f1ed",

  textPrimary: "#0b0b0b",
  textSecondary: "#52514e",
  textMuted: "#898781",

  grid: "#e1e0d9",
  baseline: "#c3c2b7",
  /** Flattened from tokens.css's rgba(11,11,11,0.1) — react-pdf borders need
   *  a concrete color, and the page is always the opaque surface below it. */
  border: "#e3e2df",

  series1: "#2a78d6", // Cost Savings
  series2: "#eb6834", // Productivity Gains
  series3: "#1baf7a", // Risk Reduction

  accent: "#2a78d6",
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
} as const;

export const CATEGORY_HUE_PDF: Record<Category, string> = {
  "Cost Savings": PDF_COLORS.series1,
  "Productivity Gains": PDF_COLORS.series2,
  "Risk Reduction": PDF_COLORS.series3,
};

/** Number formatting. Compact forms match the chart axis SI suffixes so labels
 * and ticks read as one system: lowercase k, uppercase M. */

export function money(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function compactMoney(value: number): string {
  const magnitude = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (magnitude >= 1_000_000) return `${sign}$${(magnitude / 1_000_000).toFixed(1)}M`;
  if (magnitude >= 1_000) return `${sign}$${Math.round(magnitude / 1_000)}k`;
  return `${sign}$${Math.round(magnitude)}`;
}

export function percent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

export function months(value: number | null, termYears: number): string {
  if (value === null) return `> ${termYears * 12} mo`;
  if (value === 0) return "Immediate";
  return `${value.toFixed(1)} mo`;
}

/** Currency-ish units render with a $ prefix; the rest get a trailing unit. */
const CURRENCY_UNITS = new Set(["USD", "USD/year", "USD/hour", "USD/GB"]);

export const isCurrency = (unit: string): boolean => CURRENCY_UNITS.has(unit);

export function unitSuffix(unit: string): string | null {
  switch (unit) {
    case "USD/year":
      return "/yr";
    case "USD/hour":
      return "/hr";
    case "USD/GB":
      return "/GB";
    case "percent":
      return "%";
    case "hours":
      return "hrs";
    case "minutes":
      return "min";
    case "days":
      return "days";
    case "GB":
      return "GB";
    case "FTE":
      return "FTE";
    default:
      return null;
  }
}

/** Step size that feels right when dragging or nudging a field of this size. */
export function stepFor(unit: string, value: number): number {
  if (unit === "percent") return 0.5;
  if (isCurrency(unit)) {
    if (value >= 100_000) return 5_000;
    if (value >= 10_000) return 1_000;
    if (value >= 1_000) return 100;
    if (value >= 100) return 10;
    return 0.5;
  }
  return value >= 1_000 ? 100 : value >= 100 ? 10 : value >= 10 ? 1 : 0.1;
}

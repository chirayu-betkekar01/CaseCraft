import { niceScale } from "../lib/chart";
import type { Category, DriverResult } from "../lib/types";

/**
 * The library caps at 12 drivers today (enforced on the backend by
 * test_exactly_twelve_drivers_split_four_per_category), and 12 was verified
 * by hand to still fit one Letter page with real headroom to spare. This is
 * a defensive ceiling, not a display-density cut: if the library ever grows
 * past 12 without this file being revisited, the page degrades by showing a
 * "+N more" footer instead of silently overflowing to a second page.
 */
export const CONTRIBUTION_DRIVER_LIMIT = 12;

export interface TruncatedDrivers {
  shown: DriverResult[];
  rest: { count: number; totalAnnualValue: number } | null;
}

/**
 * Caps the driver list so the page height stays bounded no matter how many
 * drivers a rep selected. Sorted high to low, same as the on-screen table
 * and chart, so both views agree on which drivers matter most.
 */
export function truncateDrivers(
  drivers: DriverResult[],
  limit = CONTRIBUTION_DRIVER_LIMIT,
): TruncatedDrivers {
  const sorted = [...drivers].sort((a, b) => b.annualValue - a.annualValue);
  const shown = sorted.slice(0, limit);
  const dropped = sorted.slice(limit);

  return {
    shown,
    rest:
      dropped.length > 0
        ? {
            count: dropped.length,
            totalAnnualValue: dropped.reduce((sum, d) => sum + d.annualValue, 0),
          }
        : null,
  };
}

const VALUE_GUTTER = 50;

export interface ContributionRow {
  driverId: string;
  name: string;
  category: Category;
  annualValue: number;
  barWidth: number;
}

export interface ContributionLayout {
  rows: ContributionRow[];
  labelWidth: number;
  plotWidth: number;
}

/**
 * Sizes each driver's bar proportionally to a fixed content width, reusing
 * niceScale so the longest bar corresponds to a clean rounded maximum, the
 * same principle ContributionChart.tsx uses on screen.
 *
 * Unlike the on-screen chart this returns no SVG path or y-position: the PDF
 * renders each row as a flexbox View/Text row (see pdfCharts.tsx), because
 * react-pdf's SVG-scoped Text primitive has no font-size control at all —
 * confirmed against its own type definitions — so labels can't live inside an
 * <Svg> the way the web version's <text> elements do.
 */
export function computeContributionLayout(
  drivers: DriverResult[],
  width: number,
): ContributionLayout {
  const labelWidth = Math.min(230, Math.max(90, width * 0.4));
  const plotWidth = Math.max(40, width - labelWidth - VALUE_GUTTER);

  const scale = niceScale(0, Math.max(...drivers.map((d) => d.annualValue), 1));
  const x = (value: number) => (value / (scale.max || 1)) * plotWidth;

  const rows: ContributionRow[] = drivers.map((driver) => ({
    driverId: driver.driverId,
    name: driver.name,
    category: driver.category,
    annualValue: driver.annualValue,
    barWidth: Math.max(x(driver.annualValue), 2),
  }));

  return { rows, labelWidth, plotWidth };
}

const CASH_FLOW_HEIGHT = 100;
const CASH_FLOW_PAD = { top: 6, right: 8, bottom: 14, left: 42 };

export interface CashFlowLayout {
  linePath: string;
  areaPath: string;
  zeroY: number;
  plotLeft: number;
  plotRight: number;
  ticks: { value: number; y: number }[];
  payback: { x: number; y: number } | null;
  height: number;
}

/**
 * Mirrors CashFlowChart.tsx's math, at a fixed width and a shorter fixed
 * height — the on-screen chart's 232px would eat too much of a one-page
 * budget shared with a KPI row, a second chart, and a table.
 */
export function computeCashFlowLayout(
  points: { month: number; net: number }[],
  paybackMonths: number | null,
  width: number,
): CashFlowLayout {
  const plotWidth = Math.max(40, width - CASH_FLOW_PAD.left - CASH_FLOW_PAD.right);
  const plotHeight = CASH_FLOW_HEIGHT - CASH_FLOW_PAD.top - CASH_FLOW_PAD.bottom;

  const maxMonth = points[points.length - 1]?.month ?? 1;
  const values = points.map((p) => p.net);
  const scale = niceScale(Math.min(...values), Math.max(...values));
  const span = scale.max - scale.min || 1;

  const x = (month: number) => CASH_FLOW_PAD.left + (month / maxMonth) * plotWidth;
  const y = (value: number) => CASH_FLOW_PAD.top + ((scale.max - value) / span) * plotHeight;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.month)},${y(p.net)}`).join(" ");
  const area = `${line} L${x(maxMonth)},${y(0)} L${x(0)},${y(0)} Z`;

  const payback =
    paybackMonths !== null && paybackMonths > 0 && paybackMonths <= maxMonth
      ? { x: x(paybackMonths), y: y(0) }
      : null;

  return {
    linePath: line,
    areaPath: area,
    zeroY: y(0),
    plotLeft: CASH_FLOW_PAD.left,
    plotRight: CASH_FLOW_PAD.left + plotWidth,
    ticks: scale.ticks.map((tick) => ({ value: tick, y: y(tick) })),
    payback,
    height: CASH_FLOW_HEIGHT,
  };
}

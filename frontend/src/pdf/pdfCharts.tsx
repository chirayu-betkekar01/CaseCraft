import { Circle, Line, Path, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { compactMoney } from "../lib/format";
import type { DriverResult } from "../lib/types";
import { CATEGORY_HUE_PDF, PDF_COLORS } from "./pdfColors";
import { computeCashFlowLayout, computeContributionLayout } from "./pdfLayout";

const rowStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", height: 13, marginBottom: 3 },
  label: { fontSize: 7.5, color: PDF_COLORS.textPrimary, textAlign: "right", paddingRight: 6 },
  track: { justifyContent: "center" },
  bar: { height: 7, borderRadius: 2 },
  value: { fontSize: 7.5, color: PDF_COLORS.textSecondary, paddingLeft: 6 },
});

interface ContributionProps {
  drivers: DriverResult[];
  width: number;
}

/**
 * A static, one-shot redraw of ContributionChart.tsx's bars for the PDF — same
 * proportional-sizing math (computeContributionLayout, built on the shared
 * niceScale), but as flexbox View/Text rows rather than an SVG.
 *
 * Deliberately not SVG: react-pdf's SVG-scoped Text primitive has no
 * font-size control (verified against its own type definitions), which rules
 * out labeling bars the way the on-screen chart's real DOM SVG does.
 */
export function ContributionChartPdf({ drivers, width }: ContributionProps) {
  const layout = computeContributionLayout(drivers, width);

  return (
    <View>
      {layout.rows.map((row) => (
        <View style={rowStyles.row} key={row.driverId}>
          <Text style={[rowStyles.label, { width: layout.labelWidth }]}>{row.name}</Text>
          <View style={[rowStyles.track, { width: layout.plotWidth }]}>
            <View
              style={[
                rowStyles.bar,
                { width: row.barWidth, backgroundColor: CATEGORY_HUE_PDF[row.category] },
              ]}
            />
          </View>
          <Text style={rowStyles.value}>{compactMoney(row.annualValue)}</Text>
        </View>
      ))}
    </View>
  );
}

interface CashFlowProps {
  points: { month: number; net: number }[];
  paybackMonths: number | null;
  width: number;
}

/**
 * A static redraw of CashFlowChart.tsx's line + area, shrunk to fit a
 * one-pager alongside a KPI row, a second chart, and a table. Unlike the
 * contribution chart this genuinely needs a vector line, so it stays SVG —
 * but it never places Text inside that <Svg>, which is what the contribution
 * chart's redesign above had to work around.
 */
export function CashFlowChartPdf({ points, paybackMonths, width }: CashFlowProps) {
  const layout = computeCashFlowLayout(points, paybackMonths, width);

  return (
    <Svg width={width} height={layout.height}>
      {layout.ticks.map((tick) => (
        <Line
          key={tick.value}
          x1={layout.plotLeft}
          x2={layout.plotRight}
          y1={tick.y}
          y2={tick.y}
          stroke={PDF_COLORS.grid}
          strokeWidth={0.5}
        />
      ))}

      <Line
        x1={layout.plotLeft}
        x2={layout.plotRight}
        y1={layout.zeroY}
        y2={layout.zeroY}
        stroke={PDF_COLORS.baseline}
        strokeWidth={0.75}
      />

      <Path d={layout.areaPath} fill={PDF_COLORS.accent} fillOpacity={0.12} />
      <Path d={layout.linePath} stroke={PDF_COLORS.accent} strokeWidth={1.5} fill="none" />

      {layout.payback && (
        <Circle
          cx={layout.payback.x}
          cy={layout.payback.y}
          r={2.5}
          fill={PDF_COLORS.good}
          stroke={PDF_COLORS.surface1}
          strokeWidth={1}
        />
      )}
    </Svg>
  );
}

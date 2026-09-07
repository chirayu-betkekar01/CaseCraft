import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { compactMoney, money, months, percent } from "../lib/format";
import { CATEGORIES, type CaseMetrics, type Deal } from "../lib/types";
import { CATEGORY_HUE_PDF, PDF_COLORS } from "./pdfColors";
import { CashFlowChartPdf, ContributionChartPdf } from "./pdfCharts";
import { CONTRIBUTION_DRIVER_LIMIT, truncateDrivers } from "./pdfLayout";

const PAGE_MARGIN = 40;
/** LETTER is 612pt wide; content width is the page width minus both margins. */
const CONTENT_WIDTH = 612 - PAGE_MARGIN * 2;

const styles = StyleSheet.create({
  page: {
    padding: PAGE_MARGIN,
    fontSize: 9,
    color: PDF_COLORS.textPrimary,
    fontFamily: "Helvetica",
  },
  headerRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 14 },
  companyName: { fontSize: 18, fontWeight: 700 },
  chipsRow: { flexDirection: "row", marginTop: 4 },
  chip: {
    fontSize: 8,
    color: PDF_COLORS.textSecondary,
    backgroundColor: PDF_COLORS.surface2,
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginRight: 6,
  },
  kpiRow: { flexDirection: "row", marginBottom: 16 },
  kpi: {
    flex: 1,
    borderWidth: 1,
    borderColor: PDF_COLORS.border,
    borderRadius: 6,
    padding: 8,
    marginRight: 8,
  },
  kpiLastChild: { marginRight: 0 },
  kpiLabel: { fontSize: 7.5, color: PDF_COLORS.textMuted, marginBottom: 3 },
  kpiValue: { fontSize: 14, fontWeight: 700 },
  kpiMeta: { fontSize: 7.5, color: PDF_COLORS.textSecondary, marginTop: 3 },
  kpiMetaGood: { fontSize: 7.5, color: PDF_COLORS.good, marginTop: 3 },
  sectionTitle: { fontSize: 10, fontWeight: 700, marginBottom: 6 },
  chartSection: { marginBottom: 10 },
  restNote: { fontSize: 7.5, color: PDF_COLORS.textMuted, marginTop: 4 },
  legendRow: { flexDirection: "row", marginBottom: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", marginRight: 12 },
  legendSwatch: { width: 6, height: 6, borderRadius: 3, marginRight: 4 },
  legendLabel: { fontSize: 7, color: PDF_COLORS.textSecondary },
  table: { borderTopWidth: 1, borderTopColor: PDF_COLORS.border },
  tableHeadRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: PDF_COLORS.border,
    paddingVertical: 4,
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 15,
    borderBottomWidth: 0.5,
    borderBottomColor: PDF_COLORS.grid,
  },
  tableHeadCell: { fontSize: 7.5, color: PDF_COLORS.textMuted },
  // A fixed row height is what makes a driver name too long to fit truncate
  // with an ellipsis instead of wrapping to a second line — react-pdf's own
  // text layout does this automatically once vertical space runs out, the
  // same technique the contribution chart's rows already rely on. Without
  // it, long real driver names (much longer than any placeholder text) wrap
  // and roughly double the table's height, which is what pushed a full
  // 12-driver case onto a second page the first time this was tested.
  tableCell: { fontSize: 8 },
  colName: { flex: 2.4 },
  colValue: { flex: 1, textAlign: "right" },
  colShare: { flex: 0.8, textAlign: "right" },
  footer: {
    position: "absolute",
    bottom: PAGE_MARGIN,
    left: PAGE_MARGIN,
    right: PAGE_MARGIN,
    borderTopWidth: 1,
    borderTopColor: PDF_COLORS.border,
    paddingTop: 6,
    fontSize: 7,
    color: PDF_COLORS.textMuted,
  },
});

interface Props {
  deal: Deal;
  metrics: CaseMetrics;
  cashFlow: { month: number; net: number }[];
}

/**
 * The one-page exported business case.
 *
 * Deliberately excludes the on-screen Narrative section: every one of its
 * five sections reads "Pending" until module 4 (narrative generation) exists,
 * and shipping five empty placeholders in an exported document would read as
 * broken rather than "not built yet." Revisit this once that module ships.
 *
 * Everything here is a fixed-width, static render of data the caller already
 * computed via /api/case — no math happens in this file.
 */
export function BusinessCaseDocument({ deal, metrics, cashFlow }: Props) {
  const { shown, rest } = truncateDrivers(metrics.drivers, CONTRIBUTION_DRIVER_LIMIT);

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.companyName}>{deal.companyName}</Text>
            <View style={styles.chipsRow}>
              <Text style={styles.chip}>{metrics.drivers.length} drivers</Text>
              <Text style={styles.chip}>{money(deal.annualCost)}/yr</Text>
              <Text style={styles.chip}>{deal.termYears}-year term</Text>
            </View>
          </View>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Total annual value</Text>
            <Text style={styles.kpiValue}>{money(metrics.totalAnnualValue)}</Text>
            <Text style={styles.kpiMeta}>across {metrics.drivers.length} value drivers</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>{metrics.termYears}-year net</Text>
            <Text style={styles.kpiValue}>{money(metrics.netValue)}</Text>
            <Text style={metrics.roiPct !== null && metrics.roiPct > 0 ? styles.kpiMetaGood : styles.kpiMeta}>
              {metrics.roiPct === null ? "no cost modeled" : `${percent(metrics.roiPct)} ROI`}
            </Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Payback</Text>
            <Text style={styles.kpiValue}>{months(metrics.paybackMonths, metrics.termYears)}</Text>
            <Text style={styles.kpiMeta}>{money(deal.annualCost + deal.oneTimeCost)} up front</Text>
          </View>
          <View style={[styles.kpi, styles.kpiLastChild]}>
            <Text style={styles.kpiLabel}>{metrics.termYears}-year TCO</Text>
            <Text style={styles.kpiValue}>{money(metrics.tco)}</Text>
            <Text style={styles.kpiMeta}>vs {money(metrics.totalValue)} of value</Text>
          </View>
        </View>

        <View style={styles.chartSection}>
          <Text style={styles.sectionTitle}>Where the value comes from</Text>
          <View style={styles.legendRow}>
            {CATEGORIES.map((category) => (
              <View style={styles.legendItem} key={category}>
                <View style={[styles.legendSwatch, { backgroundColor: CATEGORY_HUE_PDF[category] }]} />
                <Text style={styles.legendLabel}>{category}</Text>
              </View>
            ))}
          </View>
          <ContributionChartPdf drivers={shown} width={CONTENT_WIDTH} />
          {rest && (
            <Text style={styles.restNote}>
              + {rest.count} more driver{rest.count === 1 ? "" : "s"} worth{" "}
              {compactMoney(rest.totalAnnualValue)}/yr — see the app for the full breakdown.
            </Text>
          )}
        </View>

        <View style={styles.chartSection}>
          <Text style={styles.sectionTitle}>Cumulative net position</Text>
          <CashFlowChartPdf points={cashFlow} paybackMonths={metrics.paybackMonths} width={CONTENT_WIDTH} />
        </View>

        <Text style={styles.sectionTitle}>Driver breakdown</Text>
        <View style={styles.table}>
          <View style={styles.tableHeadRow}>
            <Text style={[styles.tableHeadCell, styles.colName]}>Driver</Text>
            <Text style={[styles.tableHeadCell, styles.colValue]}>Annual value</Text>
            <Text style={[styles.tableHeadCell, styles.colShare]}>Share</Text>
          </View>
          {shown.map((driver) => {
            const share = metrics.totalAnnualValue ? driver.annualValue / metrics.totalAnnualValue : 0;
            return (
              <View style={styles.tableRow} key={driver.driverId}>
                <Text style={[styles.tableCell, styles.colName]}>{driver.name}</Text>
                <Text style={[styles.tableCell, styles.colValue]}>{money(driver.annualValue)}</Text>
                <Text style={[styles.tableCell, styles.colShare]}>{percent(share * 100, 1)}</Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.footer}>
          Generated {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          {" · "}Every figure is an editable illustrative assumption, not a cited statistic — adjust it in the
          app before this case goes anywhere external.
        </Text>
      </Page>
    </Document>
  );
}

import { pdf } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { BusinessCaseDocument } from "./BusinessCaseDocument";
import type { CaseMetrics, Deal, DriverResult } from "../lib/types";

/**
 * Actually generates a PDF end to end, rather than only typechecking the
 * component tree. A clean tsc pass doesn't catch a Yoga layout crash, an
 * invalid style value, or a page overflow — this does.
 *
 * Names below are the library's real, full-length driver names, not a short
 * placeholder like "Driver a". That distinction mattered in practice: an
 * earlier version of this test used short placeholders, passed, and hid a
 * real bug — a case with all 12 drivers selected genuinely overflowed to a
 * second page once real ~40-60 character names were used, because the driver
 * table had no fixed row height and long names wrapped to two lines. Testing
 * short names again would let that regress silently.
 */

const DEAL: Deal = {
  companyName: "Northwind Manufacturing",
  domain: "northwind.example",
  annualCost: 280_000,
  oneTimeCost: 60_000,
  termYears: 3,
};

function driver(
  id: string,
  name: string,
  category: DriverResult["category"],
  annualValue: number,
): DriverResult {
  return {
    driverId: id,
    name,
    category,
    annualValue,
    oneTimeValue: 0,
    formulaDisplay: "Value = x * y",
    narrative: "Some narrative.",
    inputsUsed: {},
  };
}

// All twelve drivers in the library, by their real names — the worst case for
// page length, since a rep could select every one of them.
const ALL_DRIVERS: DriverResult[] = [
  driver("tool-license-consolidation", "Tool & License Consolidation Savings", "Cost Savings", 170_000),
  driver("data-ingestion-infrastructure-reduction", "Data Ingestion & Infrastructure Cost Reduction", "Cost Savings", 75_000),
  driver("cyber-insurance-premium-reduction", "Cyber Insurance Premium Reduction", "Cost Savings", 24_500),
  driver("incident-response-retainer-avoidance", "Incident Response Retainer & Forensics Cost Avoidance", "Cost Savings", 170_000),
  driver("analyst-investigation-triage-savings", "Analyst Investigation & Triage Time Savings", "Productivity Gains", 389_423),
  driver("alert-fatigue-false-positive-reduction", "Alert Fatigue & False-Positive Reduction", "Productivity Gains", 161_538),
  driver("headcount-avoidance-automation", "Headcount Avoidance via Automation", "Productivity Gains", 240_000),
  driver("reduced-end-user-downtime", "Reduced End-User Downtime from Faster Remediation", "Productivity Gains", 123_750),
  driver("breach-expected-loss-reduction", "Breach Probability & Expected-Loss Reduction", "Risk Reduction", 526_500),
  driver("compliance-audit-fine-avoidance", "Compliance, Audit & Regulatory Fine Avoidance", "Risk Reduction", 55_962),
  driver("ransomware-interruption-avoidance", "Ransomware Business Interruption & Ransom Payment Avoidance", "Risk Reduction", 180_000),
  driver("breach-churn-reputational-avoidance", "Customer Churn & Reputational Damage Avoidance", "Risk Reduction", 113_400),
];

function buildMetrics(drivers: DriverResult[]): CaseMetrics {
  const totalAnnualValue = drivers.reduce((sum, d) => sum + d.annualValue, 0);
  const tco = DEAL.annualCost * DEAL.termYears + DEAL.oneTimeCost;
  const totalValue = totalAnnualValue * DEAL.termYears;
  return {
    drivers,
    totalAnnualValue,
    totalOneTimeValue: 0,
    valueByCategory: {},
    annualCost: DEAL.annualCost,
    oneTimeCost: DEAL.oneTimeCost,
    termYears: DEAL.termYears,
    totalValue,
    tco,
    netValue: totalValue - tco,
    roiPct: 643.0,
    paybackMonths: 1.8,
  };
}

const cashFlow = Array.from({ length: DEAL.termYears * 12 + 1 }, (_, month) => ({
  month,
  net: -(DEAL.annualCost * DEAL.termYears + DEAL.oneTimeCost) + (2_230_073 / 12) * month,
}));

/** Counts real PDF page objects in the raw byte stream — /Type /Page, not
 *  /Type /Pages (the tree root), which the negative lookahead excludes. */
function countPdfPages(bytes: Uint8Array): number {
  const text = new TextDecoder("latin1").decode(bytes);
  return (text.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

describe("BusinessCaseDocument", () => {
  it("renders every one of the library's 12 real drivers on exactly one page", async () => {
    const blob = await pdf(
      BusinessCaseDocument({ deal: DEAL, metrics: buildMetrics(ALL_DRIVERS), cashFlow }),
    ).toBlob();

    expect(blob.size).toBeGreaterThan(0);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(countPdfPages(bytes)).toBe(1);
  });

  it("renders with 6 or fewer drivers (no truncation footer needed)", async () => {
    const fewDrivers = ALL_DRIVERS.slice(0, 3);
    const blob = await pdf(
      BusinessCaseDocument({ deal: DEAL, metrics: buildMetrics(fewDrivers), cashFlow }),
    ).toBlob();

    expect(blob.size).toBeGreaterThan(0);
  });

  it("renders when the deal never pays back (paybackMonths null, roiPct null)", async () => {
    const metrics = { ...buildMetrics(ALL_DRIVERS), paybackMonths: null, roiPct: null, tco: 0 };
    const blob = await pdf(BusinessCaseDocument({ deal: DEAL, metrics, cashFlow })).toBlob();

    expect(blob.size).toBeGreaterThan(0);
  });
});

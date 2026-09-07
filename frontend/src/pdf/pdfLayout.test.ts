import { describe, expect, it } from "vitest";
import { computeCashFlowLayout, computeContributionLayout, truncateDrivers } from "./pdfLayout";
import type { DriverResult } from "../lib/types";

const driver = (id: string, annualValue: number): DriverResult => ({
  driverId: id,
  name: id,
  category: "Cost Savings",
  annualValue,
  oneTimeValue: 0,
  formulaDisplay: "",
  narrative: "",
  inputsUsed: {},
});

describe("truncateDrivers", () => {
  it("keeps everything when there are 6 or fewer drivers", () => {
    const drivers = [driver("a", 300), driver("b", 100), driver("c", 200)];

    const result = truncateDrivers(drivers);

    expect(result.shown).toHaveLength(3);
    expect(result.rest).toBeNull();
  });

  it("sorts high to low, matching the on-screen table and chart", () => {
    const drivers = [driver("low", 100), driver("high", 300), driver("mid", 200)];

    const result = truncateDrivers(drivers);

    expect(result.shown.map((d) => d.driverId)).toEqual(["high", "mid", "low"]);
  });

  it("caps at the limit and totals the rest", () => {
    const drivers = Array.from({ length: 9 }, (_, i) => driver(`d${i}`, (9 - i) * 10));

    const result = truncateDrivers(drivers, 6);

    expect(result.shown).toHaveLength(6);
    expect(result.shown.map((d) => d.driverId)).toEqual(["d0", "d1", "d2", "d3", "d4", "d5"]);
    expect(result.rest).toEqual({ count: 3, totalAnnualValue: 30 + 20 + 10 });
  });
});

describe("computeContributionLayout", () => {
  it("produces one row per driver with a positive bar width", () => {
    const drivers = [driver("a", 500), driver("b", 100)];

    const layout = computeContributionLayout(drivers, 400);

    expect(layout.rows).toHaveLength(2);
    for (const row of layout.rows) {
      expect(row.barWidth).toBeGreaterThan(0);
    }
  });

  it("gives the larger value a longer bar", () => {
    const drivers = [driver("big", 800), driver("small", 100)];

    const layout = computeContributionLayout(drivers, 400);

    const big = layout.rows.find((r) => r.driverId === "big")!.barWidth;
    const small = layout.rows.find((r) => r.driverId === "small")!.barWidth;
    expect(big).toBeGreaterThan(small);
  });

  it("never collapses a bar to zero width, even for a tiny value", () => {
    const drivers = [driver("big", 1_000_000), driver("tiny", 1)];

    const layout = computeContributionLayout(drivers, 400);

    const tiny = layout.rows.find((r) => r.driverId === "tiny")!.barWidth;
    expect(tiny).toBeGreaterThanOrEqual(2);
  });

  it("degenerates safely with a single driver", () => {
    const layout = computeContributionLayout([driver("only", 1)], 400);

    expect(layout.rows).toHaveLength(1);
    expect(Number.isFinite(layout.rows[0]!.barWidth)).toBe(true);
  });
});

describe("computeCashFlowLayout", () => {
  const points = [
    { month: 0, net: -100 },
    { month: 6, net: -40 },
    { month: 12, net: 60 },
  ];

  it("produces a line path starting at month 0", () => {
    const layout = computeCashFlowLayout(points, 8, 400);

    expect(layout.linePath.startsWith("M")).toBe(true);
    expect(layout.linePath.split(" ")).toHaveLength(3);
  });

  it("places the payback marker only when it falls inside the term", () => {
    const inside = computeCashFlowLayout(points, 8, 400);
    expect(inside.payback).not.toBeNull();

    const beyondTerm = computeCashFlowLayout(points, 999, 400);
    expect(beyondTerm.payback).toBeNull();

    const neverPaysBack = computeCashFlowLayout(points, null, 400);
    expect(neverPaysBack.payback).toBeNull();
  });

  it("keeps the zero baseline within the plotted height", () => {
    const layout = computeCashFlowLayout(points, 8, 400);

    expect(layout.zeroY).toBeGreaterThan(0);
    expect(layout.zeroY).toBeLessThan(layout.height);
  });
});

import { describe, expect, it } from "vitest";
import { barPath, niceScale } from "./chart";

describe("niceScale", () => {
  it("always contains the data", () => {
    // The original bug: an axis ending below the max drew the line outside the plot.
    for (const max of [1, 999, 3_723_635, 2_230_073, 0.4]) {
      const scale = niceScale(0, max);
      expect(scale.max).toBeGreaterThanOrEqual(max);
      expect(scale.min).toBeLessThanOrEqual(0);
    }
  });

  it("spans negatives and positives with one even step", () => {
    const { ticks, min, max } = niceScale(-340_000, 3_723_635);
    expect(min).toBeLessThanOrEqual(-340_000);
    expect(max).toBeGreaterThanOrEqual(3_723_635);

    const steps = ticks.slice(1).map((t, i) => t - (ticks[i] ?? 0));
    for (const step of steps) expect(step).toBeCloseTo(steps[0] ?? 0, 6);
  });

  it("puts a tick exactly on zero when zero is in range", () => {
    expect(niceScale(-340_000, 3_723_635).ticks).toContain(0);
  });

  it("does not crowd the short arm with its own tick count", () => {
    // A tiny negative arm beside a large positive one used to collide labels.
    const { ticks } = niceScale(-1_000, 4_000_000);
    const negative = ticks.filter((t) => t < 0);
    expect(negative.length).toBeLessThanOrEqual(1);
  });

  it("produces clean numbers, not floating point dust", () => {
    for (const tick of niceScale(0, 3).ticks) {
      expect(String(tick)).not.toMatch(/000000|999999/);
    }
  });

  it("survives a degenerate all-zero domain", () => {
    const scale = niceScale(0, 0);
    expect(scale.ticks.length).toBeGreaterThan(0);
    expect(Number.isFinite(scale.max)).toBe(true);
  });
});

describe("barPath", () => {
  it("rounds the data-end and leaves the baseline square", () => {
    const path = barPath(10, 0, 100, 16, 4);
    expect(path.startsWith("M10,0")).toBe(true);
    expect(path).toContain("A4,4");
    // Two arcs only — the top-right and bottom-right corners.
    expect(path.match(/A4,4/g)).toHaveLength(2);
  });

  it("clamps the radius to a bar too narrow to take it", () => {
    expect(barPath(0, 0, 2, 16, 4)).toContain("A2,2");
    expect(barPath(0, 0, 1, 16, 4)).toContain("A1,1");
  });

  it("falls back to a square path only at zero width", () => {
    expect(barPath(0, 0, 0, 16, 4)).not.toContain("A");
  });

  it("clamps the radius on a very short bar too", () => {
    expect(barPath(0, 0, 100, 4, 4)).toContain("A2,2");
  });
});

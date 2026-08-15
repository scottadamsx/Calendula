import { describe, it, expect } from "vitest";
import { computeMultiplier } from "./calibration";

describe("computeMultiplier (spec §16 Phase 6 acceptance)", () => {
  it("returns null below the 5-sample minimum", () => {
    expect(computeMultiplier([{ actualMinutes: 100, plannedMinutes: 50 }])).toBeNull();
    expect(
      computeMultiplier([
        { actualMinutes: 100, plannedMinutes: 50 },
        { actualMinutes: 100, plannedMinutes: 50 },
        { actualMinutes: 100, plannedMinutes: 50 },
        { actualMinutes: 100, plannedMinutes: 50 },
      ]),
    ).toBeNull();
  });

  it("five or more logged completions shift the multiplier", () => {
    const samples = [
      { actualMinutes: 140, plannedMinutes: 100 },
      { actualMinutes: 130, plannedMinutes: 100 },
      { actualMinutes: 150, plannedMinutes: 100 },
      { actualMinutes: 145, plannedMinutes: 100 },
      { actualMinutes: 135, plannedMinutes: 100 },
    ];
    const multiplier = computeMultiplier(samples);
    expect(multiplier).not.toBeNull();
    expect(multiplier).toBeCloseTo(1.4, 1);
  });

  it("uses the median, not the mean — one outlier session doesn't dominate", () => {
    const samples = [
      { actualMinutes: 100, plannedMinutes: 100 }, // 1.0
      { actualMinutes: 105, plannedMinutes: 100 }, // 1.05
      { actualMinutes: 95, plannedMinutes: 100 }, // 0.95
      { actualMinutes: 100, plannedMinutes: 100 }, // 1.0
      { actualMinutes: 800, plannedMinutes: 100 }, // 8.0 — one bad debugging session
    ];
    const multiplier = computeMultiplier(samples);
    expect(multiplier).toBeCloseTo(1.0, 1);
  });

  it("clamps to [0.5, 3.0]", () => {
    const wayOver = Array.from({ length: 5 }, () => ({ actualMinutes: 1000, plannedMinutes: 100 }));
    expect(computeMultiplier(wayOver)).toBe(3.0);
    const wayUnder = Array.from({ length: 5 }, () => ({ actualMinutes: 10, plannedMinutes: 100 }));
    expect(computeMultiplier(wayUnder)).toBe(0.5);
  });

  it("ignores zero-planned-minutes samples when checking the sample floor", () => {
    const samples = [
      { actualMinutes: 100, plannedMinutes: 0 },
      { actualMinutes: 100, plannedMinutes: 0 },
      { actualMinutes: 100, plannedMinutes: 100 },
      { actualMinutes: 100, plannedMinutes: 100 },
      { actualMinutes: 100, plannedMinutes: 100 },
    ];
    expect(computeMultiplier(samples)).toBeNull(); // only 3 usable ratios
  });
});

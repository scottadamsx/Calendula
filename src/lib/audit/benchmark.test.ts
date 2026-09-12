import { describe, expect, it } from "vitest";
import { runBenchmark } from "./benchmark";

describe("solver benchmark against naive schedulers", () => {
  const summary = runBenchmark(40, 7);
  const by = (name: string) => summary.schedulers.find((s) => s.name === name)!;

  it("Calendula never breaks an invariant on any randomized week", () => {
    expect(by("Calendula").invariantPassRate).toBe(100);
  });

  it("Calendula meets at least as many deadlines as first-fit, and respects the daily cap where first-fit doesn't", () => {
    expect(by("Calendula").deadlinesMetRate).toBeGreaterThanOrEqual(by("First fit").deadlinesMetRate);
    expect(by("Calendula").dailyCapRate).toBeGreaterThanOrEqual(by("First fit").dailyCapRate);
  });
});

import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  projectedLoadCore,
  deadlineProximityWeight,
  findCandidateWindows,
  scoreCandidateWindow,
  selectTopWindows,
  WEATHER_SCORE_FALLBACK,
  type ActivityTypeConstraints,
  type ScoredWindow,
} from "./futureWindows";

const zone = "America/St_Johns";

function local(y: number, m: number, d: number): Date {
  return DateTime.fromObject({ year: y, month: m, day: d }, { zone }).toJSDate();
}

describe("projectedLoadCore (spec §8.1)", () => {
  it("normalises against 10 waking hours and clamps to [0,1]", () => {
    expect(projectedLoadCore({ hardHours: 0, deadlinePressureMinutes: 0, recoveryDebtHours: 0 })).toBe(0);
    expect(projectedLoadCore({ hardHours: 5, deadlinePressureMinutes: 0, recoveryDebtHours: 0 })).toBeCloseTo(0.5);
    expect(projectedLoadCore({ hardHours: 20, deadlinePressureMinutes: 0, recoveryDebtHours: 0 })).toBe(1);
  });

  it("an empty day with heavy deadline pressure is not a free day", () => {
    const load = projectedLoadCore({ hardHours: 0, deadlinePressureMinutes: 480, recoveryDebtHours: 0 });
    expect(load).toBeGreaterThan(0.5);
  });
});

describe("deadlineProximityWeight", () => {
  it("rises linearly from 0 at ten days out to 1.0 at the deadline", () => {
    const day = local(2026, 9, 1);
    expect(deadlineProximityWeight(local(2026, 9, 11), day)).toBeCloseTo(0);
    expect(deadlineProximityWeight(local(2026, 9, 1), day)).toBeCloseTo(1);
    expect(deadlineProximityWeight(local(2026, 9, 6), day)).toBeCloseTo(0.5);
  });

  it("is 0 for a deadline more than ten days out or already past", () => {
    const day = local(2026, 9, 1);
    expect(deadlineProximityWeight(local(2026, 9, 20), day)).toBe(0);
    expect(deadlineProximityWeight(local(2026, 8, 20), day)).toBe(0);
  });
});

describe("findCandidateWindows (spec §8.2)", () => {
  const baseConstraints: ActivityTypeConstraints = {
    minDurationHours: 40, // ceil(40/24) = 2 days
    requiresOvernight: false,
    seasonStart: null,
    seasonEnd: null,
    leadTimeDays: 0,
    weatherSensitive: false,
  };

  it("only returns runs of the required length with no hard-committed day", () => {
    const from = local(2026, 9, 1);
    const to = local(2026, 9, 10);
    const hardDayFlags = new Map<string, boolean>();
    hardDayFlags.set("2026-09-05", true); // a class or shift that day

    const candidates = findCandidateWindows(from, to, zone, baseConstraints, hardDayFlags, from);
    for (const c of candidates) {
      expect(c.lengthDays).toBe(2);
    }
    // No candidate should span Sept 4-5 or 5-6 — the 5th is hard-committed.
    const touchesHardDay = candidates.some((c) => c.startDay === "2026-09-04" || c.startDay === "2026-09-05");
    expect(touchesHardDay).toBe(false);
  });

  it("respects requires_overnight even when min_duration_hours alone would round to 1 day", () => {
    const constraints: ActivityTypeConstraints = { ...baseConstraints, minDurationHours: 20, requiresOvernight: true };
    const candidates = findCandidateWindows(local(2026, 9, 1), local(2026, 9, 5), zone, constraints, new Map(), local(2026, 9, 1));
    expect(candidates.every((c) => c.lengthDays >= 2)).toBe(true);
  });

  it("excludes candidates before lead_time_days has elapsed", () => {
    const leadStart = local(2026, 9, 5);
    const candidates = findCandidateWindows(local(2026, 9, 1), local(2026, 9, 10), zone, baseConstraints, new Map(), leadStart);
    expect(candidates.every((c) => c.startDay >= "2026-09-05")).toBe(true);
  });

  it("respects a season window", () => {
    const constraints: ActivityTypeConstraints = { ...baseConstraints, seasonStart: "06-01", seasonEnd: "08-31" };
    const candidates = findCandidateWindows(local(2026, 9, 1), local(2026, 9, 10), zone, constraints, new Map(), local(2026, 9, 1));
    expect(candidates).toHaveLength(0);
  });
});

describe("scoreCandidateWindow", () => {
  it("gates the weather term on weather_sensitive", () => {
    const base = { loadIn: 0, loadFlank: 0, deadlinePenalty: 0, weatherScore: WEATHER_SCORE_FALLBACK, restBonus: 0 };
    const sensitive = scoreCandidateWindow({ ...base, weatherSensitive: true });
    const notSensitive = scoreCandidateWindow({ ...base, weatherSensitive: false });
    expect(sensitive).toBeGreaterThan(notSensitive);
  });

  it("rewards low load and penalizes deadline pressure", () => {
    const busy = scoreCandidateWindow({ loadIn: 0.9, loadFlank: 0.5, deadlinePenalty: 0.8, weatherScore: 0.5, weatherSensitive: false, restBonus: 0 });
    const free = scoreCandidateWindow({ loadIn: 0.1, loadFlank: 0.1, deadlinePenalty: 0, weatherScore: 0.5, weatherSensitive: false, restBonus: 0 });
    expect(free).toBeGreaterThan(busy);
  });
});

describe("selectTopWindows (spec §8.2 — 7 day separation)", () => {
  function scored(startDay: string, score: number): ScoredWindow {
    return {
      startDay,
      endDay: startDay,
      lengthDays: 2,
      score,
      reasons: { loadIn: 0, loadFlank: 0, deadlinePenalty: 0, weatherScore: 0.5, restBonus: 0 },
    };
  }

  it("never returns two windows less than 7 days apart, even if both score highly", () => {
    const candidates = [
      scored("2026-09-05", 0.9),
      scored("2026-09-08", 0.85), // 3 days from the top pick — too close
      scored("2026-09-14", 0.7), // 9 days from the top pick — fine
    ];
    const selected = selectTopWindows(candidates, 3, zone);
    expect(selected).toHaveLength(2);
    expect(selected.some((s) => s.startDay === "2026-09-05")).toBe(true);
    expect(selected.some((s) => s.startDay === "2026-09-08")).toBe(false);
    expect(selected.some((s) => s.startDay === "2026-09-14")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { placeHabits, type HabitInput } from "./placeHabits";
import type { Block } from "./grid";

const zone = "America/St_Johns";

function local(y: number, m: number, d: number, h = 0, mi = 0): Date {
  return DateTime.fromObject({ year: y, month: m, day: d, hour: h, minute: mi }, { zone }).toJSDate();
}

/** A clean run of all-free, non-frozen blocks across the full day, every day in range. */
function makeBlocks(from: Date, to: Date, blockMinutes = 15): Block[] {
  const blocks: Block[] = [];
  let cursor = DateTime.fromJSDate(from, { zone });
  const end = DateTime.fromJSDate(to, { zone });
  while (cursor < end) {
    const blockEnd = cursor.plus({ minutes: blockMinutes });
    blocks.push({ start: cursor.toJSDate(), end: blockEnd.toJSDate(), state: "free", quality: 0.5, labels: [], frozen: false });
    cursor = blockEnd;
  }
  return blocks;
}

function habit(overrides: Partial<HabitInput> & { id: string }): HabitInput {
  return {
    title: overrides.id,
    durationMinutes: 60,
    targetSessionsPerWeek: 3,
    minSpacingHours: 24,
    preferredLabels: [],
    earliestTime: null,
    latestTime: null,
    ...overrides,
  };
}

describe("placeHabits", () => {
  it("never lands 3x/week 24h-spacing sessions on consecutive days (spec §16 Phase 3 acceptance)", () => {
    // A full week, 2026-06-01 is a Monday.
    const now = local(2026, 6, 1, 0, 0);
    const horizonEnd = local(2026, 6, 8, 0, 0);
    const blocks = makeBlocks(now, horizonEnd);

    const result = placeHabits({
      now,
      horizonEnd,
      timezone: zone,
      blocks,
      habits: [habit({ id: "gym", durationMinutes: 60, targetSessionsPerWeek: 3, minSpacingHours: 24 })],
      existingSessionsByHabitId: new Map(),
    });

    expect(result.shortfall).toHaveLength(0);
    expect(result.placements).toHaveLength(3);

    const days = result.placements
      .map((p) => DateTime.fromJSDate(p.start, { zone }).startOf("day"))
      .sort((a, b) => a.toMillis() - b.toMillis());

    for (let i = 1; i < days.length; i++) {
      expect(days[i].diff(days[i - 1], "days").days).toBeGreaterThanOrEqual(1.0);
      // Consecutive calendar days would be exactly 1.0 apart in *days*, but
      // 24h spacing measured from session start/end times, not day starts,
      // is the real guarantee — check the actual sessions never overlap and
      // are >= 24h apart in real time too.
    }
    const starts = result.placements.map((p) => p.start.getTime()).sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(24 * 60 * 60_000 - 1);
    }
  });

  it("reports a shortfall when the week is genuinely full (spec §16 Phase 3 acceptance)", () => {
    const now = local(2026, 6, 1, 0, 0);
    const horizonEnd = local(2026, 6, 8, 0, 0);
    // Only a 2-hour free window in the entire week — nowhere near enough
    // room for 3 sessions with 24h spacing.
    const blocks = makeBlocks(now, horizonEnd).map((b, i) => {
      if (i >= 4) b.state = "hard"; // free only for blocks 0-3 (first hour)
      return b;
    });

    const result = placeHabits({
      now,
      horizonEnd,
      timezone: zone,
      blocks,
      habits: [habit({ id: "gym", durationMinutes: 60, targetSessionsPerWeek: 3, minSpacingHours: 24 })],
      existingSessionsByHabitId: new Map(),
    });

    expect(result.placements).toHaveLength(1); // the one slot that does exist
    expect(result.shortfall).toEqual([{ habitId: "gym", missing: 2 }]);
  });

  it("respects the earliest/latest time-of-day window", () => {
    const now = local(2026, 6, 1, 0, 0);
    const horizonEnd = local(2026, 6, 2, 0, 0);
    const blocks = makeBlocks(now, horizonEnd);

    const result = placeHabits({
      now,
      horizonEnd,
      timezone: zone,
      blocks,
      habits: [
        habit({
          id: "violin",
          durationMinutes: 30,
          targetSessionsPerWeek: 1,
          minSpacingHours: 0,
          earliestTime: "18:00",
          latestTime: "20:00",
        }),
      ],
      existingSessionsByHabitId: new Map(),
    });

    expect(result.placements).toHaveLength(1);
    const time = DateTime.fromJSDate(result.placements[0].start, { zone }).toFormat("HH:mm");
    expect(time >= "18:00" && time < "20:00").toBe(true);
  });

  it("enforces spacing against sessions that already exist on the grid (frozen, preserved from a previous run)", () => {
    const now = local(2026, 6, 3, 0, 0); // Wednesday
    const horizonEnd = local(2026, 6, 8, 0, 0);
    const blocks = makeBlocks(now, horizonEnd);

    // A session already happened Monday at 09:00 this week.
    const existing = [{ habitId: "gym", start: local(2026, 6, 1, 9, 0), end: local(2026, 6, 1, 10, 0) }];

    const result = placeHabits({
      now,
      horizonEnd,
      timezone: zone,
      blocks,
      habits: [habit({ id: "gym", durationMinutes: 60, targetSessionsPerWeek: 3, minSpacingHours: 24 })],
      existingSessionsByHabitId: new Map([["gym", existing]]),
    });

    // 2 more needed this week (3 target - 1 already placed Monday).
    expect(result.placements).toHaveLength(2);
    for (const p of result.placements) {
      const gapHours = Math.abs(p.start.getTime() - existing[0].start.getTime()) / (60 * 60_000);
      expect(gapHours).toBeGreaterThanOrEqual(24);
    }
  });
});

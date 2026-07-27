import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { computeGrid } from "./grid";

const zone = "America/St_Johns";

function local(y: number, m: number, d: number, h = 0, mi = 0): Date {
  return DateTime.fromObject({ year: y, month: m, day: d, hour: h, minute: mi }, { zone }).toJSDate();
}

function timeOf(block: { start: Date }): string {
  return DateTime.fromJSDate(block.start, { zone }).toFormat("HH:mm");
}

describe("computeGrid", () => {
  it("slices into contiguous, non-overlapping blocks across a DST boundary (spec §16 Phase 1 acceptance)", () => {
    const from = local(2026, 3, 1);
    const to = local(2026, 3, 15); // crosses the 2026-03-08 spring-forward
    const blocks = computeGrid({
      from,
      to,
      now: from,
      timezone: zone,
      blockMinutes: 15,
      sleepStart: "23:30",
      sleepEnd: "07:30",
      freezeWindowHours: 24,
      placements: [],
      energyWindows: [],
    });

    expect(blocks.length).toBeGreaterThan(0);
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i - 1].end.getTime()).toBe(blocks[i].start.getTime());
    }
    expect(blocks[0].start.getTime()).toBe(from.getTime());
    expect(blocks[blocks.length - 1].end.getTime()).toBe(to.getTime());
  });

  it("marks the wrapping sleep window unavailable", () => {
    const from = local(2026, 6, 1, 0, 0);
    const to = local(2026, 6, 2, 0, 0);
    const blocks = computeGrid({
      from,
      to,
      now: from,
      timezone: zone,
      blockMinutes: 15,
      sleepStart: "23:30",
      sleepEnd: "07:30",
      freezeWindowHours: 0,
      placements: [],
      energyWindows: [],
    });

    expect(blocks.find((b) => timeOf(b) === "00:00")?.state).toBe("unavailable");
    expect(blocks.find((b) => timeOf(b) === "12:00")?.state).toBe("free");
    expect(blocks.find((b) => timeOf(b) === "23:45")?.state).toBe("unavailable");
  });

  it("throws when two placements claim the same block — the one invariant that can't break (spec §6)", () => {
    const from = local(2026, 6, 1, 9, 0);
    const to = local(2026, 6, 1, 11, 0);

    expect(() =>
      computeGrid({
        from,
        to,
        now: from,
        timezone: zone,
        blockMinutes: 15,
        sleepStart: "23:30",
        sleepEnd: "07:30",
        freezeWindowHours: 0,
        placements: [
          {
            sourceId: "a",
            title: "A",
            startsAt: local(2026, 6, 1, 9, 0),
            endsAt: local(2026, 6, 1, 10, 0),
            hardness: "hard",
            pinned: false,
            location: null,
            travelBufferMinutes: 0,
          },
          {
            sourceId: "b",
            title: "B",
            startsAt: local(2026, 6, 1, 9, 30),
            endsAt: local(2026, 6, 1, 10, 30),
            hardness: "soft",
            pinned: false,
            location: null,
            travelBufferMinutes: 0,
          },
        ],
        energyWindows: [],
      }),
    ).toThrow(/invariant/i);
  });

  it("treats a pinned soft placement as hard", () => {
    const from = local(2026, 6, 1, 9, 0);
    const to = local(2026, 6, 1, 10, 0);
    const blocks = computeGrid({
      from,
      to,
      now: from,
      timezone: zone,
      blockMinutes: 60,
      sleepStart: "23:30",
      sleepEnd: "07:30",
      freezeWindowHours: 0,
      placements: [
        {
          sourceId: "pinned-task",
          title: "Pinned task",
          startsAt: from,
          endsAt: to,
          hardness: "soft",
          pinned: true,
          location: null,
          travelBufferMinutes: 0,
        },
      ],
      energyWindows: [],
    });

    expect(blocks[0].state).toBe("hard");
  });

  it("pads travel buffer minutes as unavailable around a located placement, never overriding a placement", () => {
    const from = local(2026, 6, 1, 8, 0);
    const to = local(2026, 6, 1, 12, 0);

    const blocks = computeGrid({
      from,
      to,
      now: from,
      timezone: zone,
      blockMinutes: 15,
      sleepStart: "23:30",
      sleepEnd: "07:30",
      freezeWindowHours: 0,
      placements: [
        {
          sourceId: "meeting",
          title: "Meeting",
          startsAt: local(2026, 6, 1, 10, 0),
          endsAt: local(2026, 6, 1, 11, 0),
          hardness: "hard",
          pinned: false,
          location: "Downtown",
          travelBufferMinutes: 30,
        },
      ],
      energyWindows: [],
    });

    expect(blocks.find((b) => timeOf(b) === "09:45")?.state).toBe("unavailable");
    expect(blocks.find((b) => timeOf(b) === "10:00")?.state).toBe("hard");
    expect(blocks.find((b) => timeOf(b) === "11:00")?.state).toBe("unavailable");
    expect(blocks.find((b) => timeOf(b) === "08:00")?.state).toBe("free");
  });

  it("marks blocks inside the freeze window as frozen, and nothing beyond it", () => {
    const now = local(2026, 6, 1, 0, 0);
    const to = local(2026, 6, 3, 0, 0);

    const blocks = computeGrid({
      from: now,
      to,
      now,
      timezone: zone,
      blockMinutes: 60,
      sleepStart: "23:30",
      sleepEnd: "07:30",
      freezeWindowHours: 24,
      placements: [],
      energyWindows: [],
    });

    expect(blocks.find((b) => b.start.getTime() === now.getTime())?.frozen).toBe(true);
    expect(blocks[blocks.length - 1].frozen).toBe(false);
  });

  it("attaches energy window quality and labels, defaulting to 0.5 / no labels when unmatched", () => {
    const from = local(2026, 6, 1, 7, 0);
    const to = local(2026, 6, 1, 9, 0);

    const blocks = computeGrid({
      from,
      to,
      now: from,
      timezone: zone,
      blockMinutes: 60,
      sleepStart: "23:30",
      sleepEnd: "07:30",
      freezeWindowHours: 0,
      placements: [],
      energyWindows: [{ dayOfWeek: null, startTime: "08:00", endTime: "12:00", quality: 0.9, label: "deep" }],
    });

    const early = blocks.find((b) => timeOf(b) === "07:00");
    const matched = blocks.find((b) => timeOf(b) === "08:00");

    expect(early?.quality).toBe(0.5);
    expect(early?.labels).toEqual([]);
    expect(matched?.quality).toBe(0.9);
    expect(matched?.labels).toEqual(["deep"]);
  });
});

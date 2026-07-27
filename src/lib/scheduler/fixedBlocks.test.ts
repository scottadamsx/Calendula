import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { expandFixedBlock } from "./fixedBlocks";

const zone = "America/St_Johns";

describe("expandFixedBlock", () => {
  it("keeps local wall-clock time stable across a DST boundary (spec §16 Phase 1 acceptance)", () => {
    const firstMonday = DateTime.fromObject({ year: 2026, month: 2, day: 2, hour: 9 }, { zone });
    const block = {
      id: "class-1",
      startsAt: firstMonday.toJSDate(),
      endsAt: firstMonday.plus({ minutes: 90 }).toJSDate(),
      rrule: "FREQ=WEEKLY;BYDAY=MO",
    };

    // America/St_Johns springs forward on 2026-03-08 — horizon spans it.
    const from = DateTime.fromObject({ year: 2026, month: 2, day: 1 }, { zone }).toJSDate();
    const to = DateTime.fromObject({ year: 2026, month: 3, day: 31 }, { zone }).toJSDate();

    const occurrences = expandFixedBlock(block, zone, from, to);
    expect(occurrences.length).toBeGreaterThanOrEqual(8);

    for (const occ of occurrences) {
      const local = DateTime.fromJSDate(occ.start, { zone });
      expect(local.weekday).toBe(1); // Monday
      expect(local.hour).toBe(9);
      expect(local.minute).toBe(0);
      expect(DateTime.fromJSDate(occ.end, { zone }).diff(local, "minutes").minutes).toBe(90);
    }

    const boundary = DateTime.fromObject({ year: 2026, month: 3, day: 8 }, { zone });
    const before = occurrences.find((o) => DateTime.fromJSDate(o.start, { zone }) < boundary);
    const after = occurrences.find((o) => DateTime.fromJSDate(o.start, { zone }) > boundary);
    expect(before).toBeDefined();
    expect(after).toBeDefined();

    // The UTC offset actually changed — proves this crossed real DST, and
    // local time held at 9:00 anyway rather than drifting to 8:00 or 10:00.
    const offsetBefore = DateTime.fromJSDate(before!.start, { zone }).offset;
    const offsetAfter = DateTime.fromJSDate(after!.start, { zone }).offset;
    expect(offsetBefore).not.toBe(offsetAfter);
  });

  it("expands a non-recurring block only when its instance falls in range", () => {
    const start = DateTime.fromObject({ year: 2026, month: 6, day: 1, hour: 10 }, { zone });
    const block = {
      id: "one-off",
      startsAt: start.toJSDate(),
      endsAt: start.plus({ hours: 1 }).toJSDate(),
      rrule: null,
    };

    const inRange = expandFixedBlock(
      block,
      zone,
      DateTime.fromObject({ year: 2026, month: 5, day: 1 }, { zone }).toJSDate(),
      DateTime.fromObject({ year: 2026, month: 7, day: 1 }, { zone }).toJSDate(),
    );
    expect(inRange).toHaveLength(1);

    const outOfRange = expandFixedBlock(
      block,
      zone,
      DateTime.fromObject({ year: 2026, month: 8, day: 1 }, { zone }).toJSDate(),
      DateTime.fromObject({ year: 2026, month: 9, day: 1 }, { zone }).toJSDate(),
    );
    expect(outOfRange).toHaveLength(0);
  });
});

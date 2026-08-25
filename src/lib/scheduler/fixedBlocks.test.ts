import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { expandFixedBlock, findFixedBlockConflict } from "./fixedBlocks";

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

  it("expands a multi-day BYDAY rule (e.g. work Mon-Fri) to one occurrence per matching weekday, not just the start date's own weekday", () => {
    // A Monday 9am-5pm shift, repeating Mon-Fri — the fix for "I have work
    // every day Monday to Friday" needing 5 separate entries.
    const monday = DateTime.fromObject({ year: 2026, month: 9, day: 7, hour: 9 }, { zone }); // a Monday
    const block = {
      id: "weekday-job",
      startsAt: monday.toJSDate(),
      endsAt: monday.plus({ hours: 8 }).toJSDate(),
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    };

    const occurrences = expandFixedBlock(
      block,
      zone,
      monday.toJSDate(),
      monday.plus({ days: 6 }).toJSDate(), // through Sunday — the range is inclusive on both ends, so +7 would also catch next Monday
    );
    // Mon, Tue, Wed, Thu, Fri of that week — not Sat/Sun.
    expect(occurrences).toHaveLength(5);
    const weekdays = occurrences.map((o) => DateTime.fromJSDate(o.start, { zone }).weekday);
    expect(weekdays).toEqual([1, 2, 3, 4, 5]);
    // Same time-of-day (9am) preserved on every occurrence.
    expect(occurrences.every((o) => DateTime.fromJSDate(o.start, { zone }).hour === 9)).toBe(true);
  });
});

describe("findFixedBlockConflict", () => {
  const zone2 = "America/St_Johns";
  function local(y: number, m: number, d: number, h = 0, mi = 0): Date {
    return DateTime.fromObject({ year: y, month: m, day: d, hour: h, minute: mi }, { zone: zone2 }).toJSDate();
  }

  it("catches a recurring block landing inside a longer one-off block (the live bug: a weekly habit falling during a vacation week)", () => {
    const vacation = { title: "Vacation to Trinidad", start: local(2026, 8, 28, 11, 35), end: local(2026, 9, 5, 23, 35) };
    // "Sunday Reset" recurs weekly; one of its occurrences (Aug 30) falls inside the vacation.
    const candidateOccurrences = [
      { start: local(2026, 8, 23, 10, 30), end: local(2026, 8, 24, 0, 30) }, // before vacation, fine
      { start: local(2026, 8, 30, 10, 30), end: local(2026, 8, 31, 0, 30) }, // inside vacation — conflict
    ];
    const conflict = findFixedBlockConflict(candidateOccurrences, [vacation]);
    expect(conflict?.title).toBe("Vacation to Trinidad");
  });

  it("returns null when nothing overlaps", () => {
    const existing = [{ title: "Class", start: local(2026, 8, 24, 9), end: local(2026, 8, 24, 10) }];
    const candidate = [{ start: local(2026, 8, 24, 10), end: local(2026, 8, 24, 11) }]; // back-to-back, not overlapping
    expect(findFixedBlockConflict(candidate, existing)).toBeNull();
  });

  it("detects partial overlap, not just containment", () => {
    const existing = [{ title: "Shift", start: local(2026, 8, 24, 9), end: local(2026, 8, 24, 17) }];
    const candidate = [{ start: local(2026, 8, 24, 16), end: local(2026, 8, 24, 18) }];
    expect(findFixedBlockConflict(candidate, existing)?.title).toBe("Shift");
  });
});

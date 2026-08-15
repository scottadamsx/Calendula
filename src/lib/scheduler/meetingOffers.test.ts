import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  findCandidateStarts,
  travelFeasible,
  energyFit,
  earliness,
  sumSlackDelta,
  selectGreedy,
  precedingPlacement,
  formatOfferMessage,
} from "./meetingOffers";
import type { Block, MergedPlacement } from "./grid";

const zone = "America/St_Johns";

function local(y: number, m: number, d: number, h = 0, mi = 0): Date {
  return DateTime.fromObject({ year: y, month: m, day: d, hour: h, minute: mi }, { zone }).toJSDate();
}

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

describe("findCandidateStarts", () => {
  it("only returns starts where the full duration fits in free/soft blocks", () => {
    const blocks = makeBlocks(local(2026, 6, 1, 8, 0), local(2026, 6, 1, 10, 0));
    // Mark 9:00-9:30 as hard — a 60-minute meeting starting at 8:45 would collide.
    for (const b of blocks) {
      const t = DateTime.fromJSDate(b.start, { zone }).toFormat("HH:mm");
      if (t === "09:00" || t === "09:15") b.state = "hard";
    }

    const candidates = findCandidateStarts(blocks, 60, zone);
    for (const c of candidates) {
      for (let i = c.startIndex; i < c.startIndex + c.length; i++) {
        expect(blocks[i].state === "free" || blocks[i].state === "soft").toBe(true);
      }
    }
    // A start at 8:15 would span 8:15-9:15, touching the hard block — must not appear.
    const at815 = candidates.find((c) => DateTime.fromJSDate(c.start, { zone }).toFormat("HH:mm") === "08:15");
    expect(at815).toBeUndefined();
  });

  it("caps results at 20 candidates", () => {
    const blocks = makeBlocks(local(2026, 6, 1, 0, 0), local(2026, 6, 3, 0, 0)); // 2 days, all free
    const candidates = findCandidateStarts(blocks, 15, zone);
    expect(candidates.length).toBeLessThanOrEqual(20);
  });

  it("spreads the 20-candidate cap across multiple days instead of exhausting it on one wide-open day (regression — spec §9.1 day-spread)", () => {
    // A full week, all free, 15-minute blocks — one single day alone could
    // produce dozens of raw 60-minute-window candidates on its own.
    const blocks = makeBlocks(local(2026, 6, 1, 0, 0), local(2026, 6, 8, 0, 0));
    const candidates = findCandidateStarts(blocks, 60, zone);

    expect(candidates.length).toBeGreaterThan(0);
    const distinctDays = new Set(candidates.map((c) => DateTime.fromJSDate(c.start, { zone }).toISODate()));
    expect(distinctDays.size).toBeGreaterThan(1);
  });
});

describe("travelFeasible (spec §9.1 example)", () => {
  it("rejects a downtown coffee at 4:15 when the preceding placement is on campus until 4:00 with a 30min buffer", () => {
    const preceding = { location: "Campus", end: local(2026, 6, 1, 16, 0) };
    const candidateStart = local(2026, 6, 1, 16, 15);
    const result = travelFeasible(candidateStart, preceding, "Downtown", 30);
    expect(result).toBe(0);
  });

  it("allows it once the gap covers the travel buffer", () => {
    const preceding = { location: "Campus", end: local(2026, 6, 1, 16, 0) };
    const candidateStart = local(2026, 6, 1, 16, 35);
    const result = travelFeasible(candidateStart, preceding, "Downtown", 30);
    expect(result).toBe(1);
  });

  it("is always feasible when locations match or nothing precedes it", () => {
    expect(travelFeasible(local(2026, 6, 1, 10, 0), null, "Downtown", 30)).toBe(1);
    expect(
      travelFeasible(
        local(2026, 6, 1, 10, 0),
        { location: "Downtown", end: local(2026, 6, 1, 9, 55) },
        "Downtown",
        30,
      ),
    ).toBe(1);
  });
});

describe("energyFit", () => {
  it("matches social meetings to social-labelled blocks", () => {
    expect(energyFit(["social"], "social")).toBe(1);
    expect(energyFit(["deep"], "social")).toBe(0);
  });
});

describe("earliness", () => {
  it("scores sooner candidates higher, within [0,1]", () => {
    const now = local(2026, 6, 1, 0, 0);
    const horizonEnd = local(2026, 6, 15, 0, 0);
    const soon = earliness(local(2026, 6, 2, 0, 0), now, horizonEnd);
    const later = earliness(local(2026, 6, 10, 0, 0), now, horizonEnd);
    expect(soon).toBeGreaterThan(later);
    expect(soon).toBeLessThanOrEqual(1);
    expect(later).toBeGreaterThanOrEqual(0);
  });
});

describe("sumSlackDelta", () => {
  it("sums slack lost for tasks that got worse, ignores tasks that improved", () => {
    const baseline = [{ taskId: "a", slackMinutes: 100 }];
    const after = [
      { taskId: "a", slackMinutes: 40 }, // lost 60
      { taskId: "b", slackMinutes: 90 }, // new at-risk, assumed baseline 120 -> lost 30
    ];
    expect(sumSlackDelta(baseline, after)).toBe(90);
  });

  it("returns 0 when nothing is worse", () => {
    expect(sumSlackDelta([{ taskId: "a", slackMinutes: 50 }], [{ taskId: "a", slackMinutes: 80 }])).toBe(0);
  });
});

describe("selectGreedy (spec §9.1 day-spread)", () => {
  it("never offers two slots on the same day, even if both score highly", () => {
    const scored = [
      { start: local(2026, 6, 4, 14, 0), end: local(2026, 6, 4, 15, 0), score: 0.9 },
      { start: local(2026, 6, 4, 16, 0), end: local(2026, 6, 4, 17, 0), score: 0.85 }, // same day, lower score
      { start: local(2026, 6, 5, 10, 0), end: local(2026, 6, 5, 11, 0), score: 0.8 },
      { start: local(2026, 6, 6, 13, 0), end: local(2026, 6, 6, 14, 0), score: 0.7 },
    ];

    const selected = selectGreedy(scored, 3, zone);
    expect(selected).toHaveLength(3);
    const days = selected.map((s) => DateTime.fromJSDate(s.start, { zone }).toISODate());
    expect(new Set(days).size).toBe(3);
    // The higher-scored 14:00 slot wins over the same-day 16:00 one.
    expect(selected.some((s) => s.start.getTime() === local(2026, 6, 4, 14, 0).getTime())).toBe(true);
    expect(selected.some((s) => s.start.getTime() === local(2026, 6, 4, 16, 0).getTime())).toBe(false);
  });
});

describe("precedingPlacement", () => {
  it("finds the placement that ends soonest before the candidate, ignoring later ones", () => {
    const placements: MergedPlacement[] = [
      { sourceId: "a", start: local(2026, 6, 1, 8, 0), end: local(2026, 6, 1, 9, 0), state: "hard", location: "Home" },
      { sourceId: "b", start: local(2026, 6, 1, 13, 0), end: local(2026, 6, 1, 14, 0), state: "hard", location: "Campus" },
      { sourceId: "c", start: local(2026, 6, 1, 17, 0), end: local(2026, 6, 1, 18, 0), state: "hard", location: "Gym" },
    ];
    const result = precedingPlacement(placements, local(2026, 6, 1, 16, 0));
    expect(result?.location).toBe("Campus");
  });
});

describe("formatOfferMessage (spec §9.3 — pasteable text)", () => {
  it("joins three slots with commas and a trailing 'or', in plain readable form", () => {
    const msg = formatOfferMessage(
      [
        { start: local(2026, 6, 4, 14, 0), end: local(2026, 6, 4, 15, 0) },
        { start: local(2026, 6, 5, 9, 0), end: local(2026, 6, 5, 10, 0) },
        { start: local(2026, 6, 6, 13, 0), end: local(2026, 6, 6, 14, 0) },
      ],
      zone,
    );
    expect(msg).toContain("Thursday");
    expect(msg).toContain("Friday");
    expect(msg).toContain("Saturday");
    expect(msg).toContain("or");
    expect(msg.endsWith("whichever's easiest.")).toBe(true);
  });

  it("is honest when there's nothing to offer", () => {
    expect(formatOfferMessage([], zone)).not.toContain("whichever's easiest");
  });
});

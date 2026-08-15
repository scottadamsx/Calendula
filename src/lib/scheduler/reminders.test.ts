import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  receptivity,
  urgency,
  effectiveDeadline,
  assignRemindersCore,
  applyBatching,
  formatDigestMessage,
  type AttentionProfile,
  type ReminderCandidate,
  type ReminderAssignment,
} from "./reminders";
import type { Block } from "./grid";

const zone = "America/St_Johns";

function local(y: number, m: number, d: number, h = 0, mi = 0): Date {
  return DateTime.fromObject({ year: y, month: m, day: d, hour: h, minute: mi }, { zone }).toJSDate();
}

function makeBlocks(from: Date, count: number, minutes = 60): Block[] {
  const blocks: Block[] = [];
  let cursor = DateTime.fromJSDate(from, { zone });
  for (let i = 0; i < count; i++) {
    const end = cursor.plus({ minutes });
    blocks.push({ start: cursor.toJSDate(), end: end.toJSDate(), state: "free", quality: 0.5, labels: [], frozen: false });
    cursor = end;
  }
  return blocks;
}

const defaultProfile: AttentionProfile = {
  attentionBudgetPerDay: 5,
  minGapMinutes: 45,
  quietStart: null,
  quietEnd: null,
  batchByDefault: true,
  promoteAfterDefers: 3,
};

function moment(id: string, dueAt: Date, importance = 3): ReminderCandidate {
  return {
    id,
    kind: "moment",
    dueAt,
    windowStart: null,
    windowEnd: null,
    triggerPlacementStart: null,
    leadMinutes: 0,
    importance,
    deferCount: 0,
  };
}

describe("receptivity (spec §10.2)", () => {
  const ctx = { timezone: zone, isNearBoundary: false, deliveredCountToday: 0, minutesSinceLastDelivery: null, importance: 3 };

  it("is a hard floor for unavailable, hard, and tentative blocks", () => {
    const base: Block = { start: local(2026, 6, 1, 10), end: local(2026, 6, 1, 11), quality: 0.5, labels: [], frozen: false, state: "free" };
    expect(receptivity({ ...base, state: "unavailable" }, defaultProfile, ctx)).toBe(0);
    expect(receptivity({ ...base, state: "hard" }, defaultProfile, ctx)).toBe(0);
    expect(receptivity({ ...base, state: "tentative" }, defaultProfile, ctx)).toBe(0);
  });

  it("scores free blocks higher than soft/deep blocks", () => {
    const free: Block = { start: local(2026, 6, 1, 10), end: local(2026, 6, 1, 11), quality: 0.5, labels: [], frozen: false, state: "free" };
    const softDeep: Block = { ...free, state: "soft", labels: ["deep"] };
    const softAdmin: Block = { ...free, state: "soft", labels: ["admin"] };
    expect(receptivity(free, defaultProfile, ctx)).toBeGreaterThan(receptivity(softAdmin, defaultProfile, ctx));
    expect(receptivity(softAdmin, defaultProfile, ctx)).toBeGreaterThan(receptivity(softDeep, defaultProfile, ctx));
  });

  it("zeroes out once the daily budget is spent, unless importance is 5", () => {
    const free: Block = { start: local(2026, 6, 1, 10), end: local(2026, 6, 1, 11), quality: 0.5, labels: [], frozen: false, state: "free" };
    const maxed = { ...ctx, deliveredCountToday: 5 };
    expect(receptivity(free, defaultProfile, { ...maxed, importance: 3 })).toBe(0);
    expect(receptivity(free, defaultProfile, { ...maxed, importance: 5 })).toBeGreaterThan(0);
  });

  it("penalizes quiet hours", () => {
    const profile: AttentionProfile = { ...defaultProfile, quietStart: "21:00", quietEnd: "23:00" };
    const inQuiet: Block = { start: local(2026, 6, 1, 21, 30), end: local(2026, 6, 1, 22, 30), quality: 0.5, labels: [], frozen: false, state: "free" };
    const outsideQuiet: Block = { ...inQuiet, start: local(2026, 6, 1, 10), end: local(2026, 6, 1, 11) };
    expect(receptivity(inQuiet, profile, ctx)).toBeLessThan(receptivity(outsideQuiet, profile, ctx));
  });
});

describe("urgency (spec §10.3)", () => {
  it("rises toward 1 as a moment reminder's due_at approaches, scaled by importance's horizon", () => {
    const now = local(2026, 6, 1, 0, 0);
    const dueSoon = moment("a", local(2026, 6, 1, 12, 0), 3); // 12h out, horizon = 24h*3 = 72h
    const dueFar = moment("b", local(2026, 6, 5, 0, 0), 3); // 4 days out
    expect(urgency(dueSoon, now)).toBeGreaterThan(urgency(dueFar, now));
  });

  it("is 0 for latent reminders", () => {
    const r: ReminderCandidate = {
      id: "l",
      kind: "latent",
      dueAt: null,
      windowStart: null,
      windowEnd: null,
      triggerPlacementStart: null,
      leadMinutes: 0,
      importance: 3,
      deferCount: 0,
    };
    expect(urgency(r, local(2026, 6, 1, 0, 0))).toBe(0);
  });

  it("floors window urgency at 0.2 and rises as the window elapses", () => {
    const r: ReminderCandidate = {
      id: "w",
      kind: "window",
      dueAt: null,
      windowStart: local(2026, 6, 1, 0, 0),
      windowEnd: local(2026, 6, 8, 0, 0),
      triggerPlacementStart: null,
      leadMinutes: 0,
      importance: 3,
      deferCount: 0,
    };
    const atStart = urgency(r, local(2026, 6, 1, 0, 0));
    const nearEnd = urgency(r, local(2026, 6, 7, 12, 0));
    expect(atStart).toBeGreaterThanOrEqual(0.2 * (0.6 + 0.1 * 3));
    expect(nearEnd).toBeGreaterThan(atStart);
  });

  it("only fires for a context reminder within lead_minutes of its trigger placement", () => {
    const r: ReminderCandidate = {
      id: "c",
      kind: "context",
      dueAt: null,
      windowStart: null,
      windowEnd: null,
      triggerPlacementStart: local(2026, 6, 1, 16, 0),
      leadMinutes: 30,
      importance: 3,
      deferCount: 0,
    };
    expect(urgency(r, local(2026, 6, 1, 15, 45))).toBeGreaterThan(0);
    expect(urgency(r, local(2026, 6, 1, 14, 0))).toBe(0);
  });

  it("increases with defer_count — deferring makes it louder, not quieter", () => {
    const now = local(2026, 6, 1, 0, 0);
    const base = moment("a", local(2026, 6, 2, 0, 0), 3);
    const deferred = { ...base, deferCount: 3 };
    expect(urgency(deferred, now)).toBeGreaterThan(urgency(base, now));
  });
});

describe("effectiveDeadline", () => {
  it("is due_at for moment, window_end for window, trigger start for context", () => {
    expect(effectiveDeadline(moment("a", local(2026, 6, 1, 12)))?.getTime()).toBe(local(2026, 6, 1, 12).getTime());
    expect(
      effectiveDeadline({
        id: "w",
        kind: "window",
        dueAt: null,
        windowStart: local(2026, 6, 1),
        windowEnd: local(2026, 6, 3),
        triggerPlacementStart: null,
        leadMinutes: 0,
        importance: 3,
        deferCount: 0,
      })?.getTime(),
    ).toBe(local(2026, 6, 3).getTime());
  });
});

describe("assignRemindersCore (spec §16 Phase 4.5 acceptance)", () => {
  const now = local(2026, 6, 1, 8, 0);
  const blocks = makeBlocks(now, 24, 60); // 24 free, 1-hour blocks — plenty of room, well spaced past minGapMinutes

  it("assigns exactly the budget when nothing is importance 5", () => {
    const candidates = Array.from({ length: 12 }, (_, i) => moment(`r${i}`, local(2026, 6, 3, 0, 0), 3));
    const assigned = assignRemindersCore(candidates, blocks, defaultProfile, now, {
      timezone: zone,
      deliveredCountToday: 0,
      minutesSinceLastDelivery: null,
    });
    expect(assigned).toHaveLength(5);
  });

  it("lets importance-5 reminders through beyond the budget", () => {
    // Five ordinary reminders, staggered due-soon so each peaks at its own
    // distinct block — these alone fill the budget of 5. Two importance-5
    // reminders due much further out score lower than any of the five (so
    // they don't just win a budget slot on merit) — the override is only
    // exercised if they're added *after* the budget is already spent.
    const normal = [1, 2, 3, 4, 5].map((h) => moment(`r${h}`, local(2026, 6, 1, 8 + h, 0), 3));
    const urgent = [
      moment("urgent-1", local(2026, 6, 5, 8, 0), 5),
      moment("urgent-2", local(2026, 6, 5, 8, 0), 5),
    ];
    const assigned = assignRemindersCore([...normal, ...urgent], blocks, defaultProfile, now, {
      timezone: zone,
      deliveredCountToday: 0,
      minutesSinceLastDelivery: null,
    });
    expect(assigned.length).toBeGreaterThan(5);
    expect(assigned.some((a) => a.reminderId === "urgent-1")).toBe(true);
    expect(assigned.some((a) => a.reminderId === "urgent-2")).toBe(true);
  });

  it("never assigns into sleep (unavailable) or hard-placement blocks", () => {
    const mixed: Block[] = blocks.map((b, i) => ({
      ...b,
      state: i % 3 === 0 ? "unavailable" : i % 3 === 1 ? "hard" : "free",
    }));
    const candidates = Array.from({ length: 12 }, (_, i) => moment(`r${i}`, local(2026, 6, 3, 0, 0), 5)); // importance 5 so budget can't hide a bug
    const assigned = assignRemindersCore(candidates, mixed, defaultProfile, now, {
      timezone: zone,
      deliveredCountToday: 0,
      minutesSinceLastDelivery: null,
    });
    expect(assigned.length).toBeGreaterThan(0);
    for (const a of assigned) {
      const block = mixed.find((b) => b.start.getTime() === a.blockStart.getTime())!;
      expect(block.state).toBe("free");
    }
  });

  it("never schedules a moment reminder after its due_at", () => {
    const dueAt = local(2026, 6, 1, 11, 30); // inside the block range
    const candidates = [moment("tight", dueAt, 5)];
    const assigned = assignRemindersCore(candidates, blocks, defaultProfile, now, {
      timezone: zone,
      deliveredCountToday: 0,
      minutesSinceLastDelivery: null,
    });
    for (const a of assigned) {
      expect(a.blockStart.getTime()).toBeLessThanOrEqual(dueAt.getTime());
    }
  });
});

function toAssignment(id: string, blockStart: Date, blockMinutes = 15): ReminderAssignment {
  return {
    reminderId: id,
    blockStart,
    blockEnd: new Date(blockStart.getTime() + blockMinutes * 60_000),
    urgency: 0.5,
    receptivity: 0.85,
    value: 0.425,
  };
}

describe("applyBatching (spec §10.5, Phase 4.6 acceptance)", () => {
  it("groups three deliveries in the same 20-minute window and free run under one shared batch_id", () => {
    const blocks = makeBlocks(local(2026, 6, 1, 8, 0), 12, 5); // one contiguous free run, 5-minute blocks
    const assigned = [
      toAssignment("a", local(2026, 6, 1, 8, 0), 5),
      toAssignment("b", local(2026, 6, 1, 8, 5), 5),
      toAssignment("c", local(2026, 6, 1, 8, 10), 5),
    ];
    const batched = applyBatching(assigned, blocks, true);
    const ids = new Set(batched.map((b) => b.batchId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).not.toBeNull();
  });

  it("does not batch a single delivery alone", () => {
    const blocks = makeBlocks(local(2026, 6, 1, 8, 0), 12, 5);
    const assigned = [toAssignment("a", local(2026, 6, 1, 8, 0), 5)];
    const batched = applyBatching(assigned, blocks, true);
    expect(batched[0].batchId).toBeNull();
  });

  it("does not batch deliveries separated by a hard placement (different free runs)", () => {
    const blocks = makeBlocks(local(2026, 6, 1, 8, 0), 12, 5);
    blocks[2].state = "hard"; // splits the run between block 1 (8:05) and block 3 (8:15)
    const assigned = [toAssignment("a", local(2026, 6, 1, 8, 5), 5), toAssignment("b", local(2026, 6, 1, 8, 15), 5)];
    const batched = applyBatching(assigned, blocks, true);
    expect(batched.every((b) => b.batchId === null)).toBe(true);
  });

  it("never batches when batch_by_default is false", () => {
    const blocks = makeBlocks(local(2026, 6, 1, 8, 0), 12, 5);
    const assigned = [toAssignment("a", local(2026, 6, 1, 8, 0), 5), toAssignment("b", local(2026, 6, 1, 8, 5), 5)];
    const batched = applyBatching(assigned, blocks, false);
    expect(batched.every((b) => b.batchId === null)).toBe(true);
  });
});

describe("assignRemindersCore batching interaction (spec §10.5 vs §10.4's min_gap_minutes)", () => {
  it("lets two reminders land within the batch window even though it's inside min_gap_minutes, when batching is on", () => {
    const now = local(2026, 6, 1, 8, 0);
    const blocks = makeBlocks(now, 12, 5); // 5-minute blocks, one free run, well under default min_gap (45m)
    const candidates = [moment("a", local(2026, 6, 3, 0, 0), 3), moment("b", local(2026, 6, 3, 0, 0), 3)];
    const assigned = assignRemindersCore(candidates, blocks, defaultProfile, now, {
      timezone: zone,
      deliveredCountToday: 0,
      minutesSinceLastDelivery: null,
    });
    // Both tied in value, sorted onto the earliest blocks first — within the
    // 20-minute batch window of each other, same (only) free run.
    expect(assigned).toHaveLength(2);
    const gapMs = Math.abs(assigned[0].blockStart.getTime() - assigned[1].blockStart.getTime());
    expect(gapMs).toBeLessThan(defaultProfile.minGapMinutes * 60_000);
  });

  it("still enforces min_gap_minutes when batching is off", () => {
    const now = local(2026, 6, 1, 8, 0);
    const blocks = makeBlocks(now, 12, 5);
    const profile: AttentionProfile = { ...defaultProfile, batchByDefault: false };
    const candidates = [moment("a", local(2026, 6, 3, 0, 0), 3), moment("b", local(2026, 6, 3, 0, 0), 3)];
    const assigned = assignRemindersCore(candidates, blocks, profile, now, {
      timezone: zone,
      deliveredCountToday: 0,
      minutesSinceLastDelivery: null,
    });
    if (assigned.length === 2) {
      const gapMs = Math.abs(assigned[0].blockStart.getTime() - assigned[1].blockStart.getTime());
      expect(gapMs).toBeGreaterThanOrEqual(profile.minGapMinutes * 60_000);
    }
  });
});

describe("formatDigestMessage", () => {
  it("joins reminder titles and folds in the next placement (spec §10.5 example shape)", () => {
    const msg = formatDigestMessage(
      ["grab the charger", "text Dee about the sponsor post"],
      [{ title: "Gym", start: local(2026, 6, 1, 17, 30) }],
      zone,
    );
    expect(msg).toContain("grab the charger");
    expect(msg).toContain("text Dee about the sponsor post");
    expect(msg).toContain("gym's at 5:30pm");
  });

  it("is empty for no reminders", () => {
    expect(formatDigestMessage([], [], zone)).toBe("");
  });
});

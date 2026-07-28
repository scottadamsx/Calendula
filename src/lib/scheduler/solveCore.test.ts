import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { solveCore, type TaskInput } from "./solveCore";
import type { Block } from "./grid";

const zone = "America/St_Johns";

function local(y: number, m: number, d: number, h = 0, mi = 0): Date {
  return DateTime.fromObject({ year: y, month: m, day: d, hour: h, minute: mi }, { zone }).toJSDate();
}

/** A clean run of all-free, non-frozen, quality-0.5 blocks — no sleep/placements/energy windows. */
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

function task(overrides: Partial<TaskInput> & { id: string }): TaskInput {
  return {
    categoryId: null,
    title: overrides.id,
    remainingMinutes: 60,
    deadline: null,
    priority: 3,
    minChunkMinutes: 30,
    maxChunkMinutes: 120,
    splittable: true,
    preferredLabels: [],
    ...overrides,
  };
}

const baseInput = {
  timezone: zone,
  previousByTaskId: new Map(),
  calibrationByCategory: new Map(),
  maxTaskMinutesPerDay: 300,
  minBreakMinutes: 15,
  movementPenalty: 0.3,
};

function hasOverlap(placements: { start: Date; end: Date }[]): boolean {
  const sorted = [...placements].sort((a, b) => a.start.getTime() - b.start.getTime());
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start.getTime() < sorted[i - 1].end.getTime()) return true;
  }
  return false;
}

describe("solveCore", () => {
  it("places five staggered-deadline tasks, each before its own deadline (spec §16 Phase 2 acceptance)", () => {
    const now = local(2026, 6, 1, 8, 0);
    const horizonEnd = local(2026, 6, 15, 0, 0);
    const blocks = makeBlocks(now, horizonEnd);

    const tasks: TaskInput[] = [1, 2, 3, 4, 5].map((n) =>
      task({
        id: `task-${n}`,
        remainingMinutes: 60,
        deadline: local(2026, 6, 1 + n * 2, 20, 0),
        minChunkMinutes: 60,
        maxChunkMinutes: 60,
      }),
    );

    const result = solveCore({ ...baseInput, now, blocks, tasks });

    expect(result.unplaceable).toHaveLength(0);
    expect(result.placements).toHaveLength(5);
    for (const t of tasks) {
      const placement = result.placements.find((p) => p.taskId === t.id);
      expect(placement).toBeDefined();
      expect(placement!.end.getTime()).toBeLessThanOrEqual(t.deadline!.getTime());
    }
    expect(hasOverlap(result.placements)).toBe(false);
  });

  it("moves zero placements on a re-solve with no input change (spec §16 Phase 2 acceptance)", () => {
    const now = local(2026, 6, 1, 8, 0);
    const horizonEnd = local(2026, 6, 5, 0, 0);
    const tasks: TaskInput[] = [
      task({ id: "a", remainingMinutes: 60, deadline: local(2026, 6, 4, 20, 0), minChunkMinutes: 60, maxChunkMinutes: 60 }),
      task({ id: "b", remainingMinutes: 90, deadline: local(2026, 6, 3, 20, 0), minChunkMinutes: 90, maxChunkMinutes: 90 }),
    ];

    const firstRun = solveCore({ ...baseInput, now, blocks: makeBlocks(now, horizonEnd), tasks });
    expect(firstRun.unplaceable).toHaveLength(0);

    const previousByTaskId = new Map(firstRun.placements.map((p) => [p.taskId, { start: p.start, end: p.end }]));

    const secondRun = solveCore({
      ...baseInput,
      now,
      blocks: makeBlocks(now, horizonEnd),
      tasks,
      previousByTaskId,
    });

    expect(secondRun.movedCount).toBe(0);
    for (const p of firstRun.placements) {
      const again = secondRun.placements.find((x) => x.taskId === p.taskId);
      expect(again!.start.getTime()).toBe(p.start.getTime());
      expect(again!.end.getTime()).toBe(p.end.getTime());
    }
  });

  it("returns an impossible task as unplaceable rather than overlapping anything (spec §16 Phase 2 acceptance)", () => {
    const now = local(2026, 6, 1, 8, 0);
    const horizonEnd = local(2026, 6, 2, 0, 0); // one day only — not enough room
    const blocks = makeBlocks(now, horizonEnd);

    const tasks: TaskInput[] = [
      task({ id: "reasonable", remainingMinutes: 60, deadline: local(2026, 6, 1, 20, 0), minChunkMinutes: 60, maxChunkMinutes: 60 }),
      task({
        id: "impossible",
        remainingMinutes: 10_000, // far more than the whole horizon holds
        deadline: local(2026, 6, 1, 12, 0),
        splittable: false,
      }),
    ];

    const result = solveCore({ ...baseInput, now, blocks, tasks });

    expect(result.unplaceable.some((u) => u.taskId === "impossible")).toBe(true);
    expect(result.placements.some((p) => p.taskId === "impossible")).toBe(false);
    expect(hasOverlap(result.placements)).toBe(false);
  });

  it("gives a contested slot to the higher-priority task when slack ties", () => {
    const now = local(2026, 6, 1, 8, 0);
    const horizonEnd = local(2026, 6, 1, 9, 0); // exactly one 60-minute window
    const blocks = makeBlocks(now, horizonEnd);
    const deadline = local(2026, 6, 1, 9, 0);

    const tasks: TaskInput[] = [
      task({ id: "low-priority", remainingMinutes: 60, deadline, priority: 1, minChunkMinutes: 60, maxChunkMinutes: 60, splittable: false }),
      task({ id: "high-priority", remainingMinutes: 60, deadline, priority: 5, minChunkMinutes: 60, maxChunkMinutes: 60, splittable: false }),
    ];

    const result = solveCore({ ...baseInput, now, blocks, tasks });

    expect(result.placements.some((p) => p.taskId === "high-priority")).toBe(true);
    expect(result.unplaceable.some((u) => u.taskId === "low-priority")).toBe(true);
  });

  it("never exceeds max_task_minutes_per_day, leaving the rest unplaceable", () => {
    const now = local(2026, 6, 1, 8, 0);
    const horizonEnd = local(2026, 6, 2, 0, 0); // single day only
    const blocks = makeBlocks(now, horizonEnd);

    const tasks: TaskInput[] = [
      task({
        id: "big",
        remainingMinutes: 120,
        deadline: local(2026, 6, 1, 22, 0),
        minChunkMinutes: 60,
        maxChunkMinutes: 60,
      }),
    ];

    const result = solveCore({ ...baseInput, now, blocks, tasks, maxTaskMinutesPerDay: 60 });

    const placedMinutes = result.placements
      .filter((p) => p.taskId === "big")
      .reduce((sum, p) => sum + (p.end.getTime() - p.start.getTime()) / 60_000, 0);
    expect(placedMinutes).toBeLessThanOrEqual(60);
    expect(result.unplaceable.some((u) => u.taskId === "big" && u.remainingMinutes === 60)).toBe(true);
  });

  it("hard-rejects a slot that would leave an illegally small leftover on either side", () => {
    const now = local(2026, 6, 1, 8, 0);
    // A run of exactly 75 minutes (5 blocks @ 15m). A 60-minute task fits with
    // a 15-minute leftover only if minBreakMinutes <= 15; set it to 30 so
    // every offset leaves an illegal 15-minute sliver on one side or the other.
    const horizonEnd = local(2026, 6, 1, 9, 15);
    const blocks = makeBlocks(now, horizonEnd);

    const tasks: TaskInput[] = [
      task({ id: "t", remainingMinutes: 60, deadline: local(2026, 6, 1, 9, 15), minChunkMinutes: 60, maxChunkMinutes: 60, splittable: false }),
    ];

    const result = solveCore({ ...baseInput, now, blocks, tasks, minBreakMinutes: 30 });

    expect(result.unplaceable.some((u) => u.taskId === "t")).toBe(true);
  });

  it("places cleanly when the run length exactly matches the chunk (zero leftover, always legal)", () => {
    const now = local(2026, 6, 1, 8, 0);
    const horizonEnd = local(2026, 6, 1, 9, 0); // exactly 60 minutes
    const blocks = makeBlocks(now, horizonEnd);

    const tasks: TaskInput[] = [
      task({ id: "t", remainingMinutes: 60, deadline: local(2026, 6, 1, 9, 0), minChunkMinutes: 60, maxChunkMinutes: 60, splittable: false }),
    ];

    const result = solveCore({ ...baseInput, now, blocks, tasks, minBreakMinutes: 30 });

    expect(result.unplaceable).toHaveLength(0);
    expect(result.placements).toHaveLength(1);
  });

  it("leaves a non-splittable task unplaceable when no single free run is big enough, even if the total free time is", () => {
    const now = local(2026, 6, 1, 8, 0);
    const blocks = makeBlocks(now, local(2026, 6, 1, 10, 0)); // two hours

    // Split into two 45-minute free runs with a hard block between them.
    for (const b of blocks) {
      const h = DateTime.fromJSDate(b.start, { zone }).hour;
      const mi = DateTime.fromJSDate(b.start, { zone }).minute;
      if (h === 8 && mi >= 45) b.state = "hard";
      if (h === 9 && mi < 15) b.state = "hard";
    }

    const tasks: TaskInput[] = [
      task({ id: "t", remainingMinutes: 90, deadline: local(2026, 6, 1, 10, 0), splittable: false }),
    ];

    const result = solveCore({ ...baseInput, now, blocks, tasks });

    expect(result.unplaceable.some((u) => u.taskId === "t")).toBe(true);
  });

  it("places a task with no deadline last, ordered by priority among no-deadline tasks", () => {
    const now = local(2026, 6, 1, 8, 0);
    const horizonEnd = local(2026, 6, 1, 10, 0);
    const blocks = makeBlocks(now, horizonEnd);

    const tasks: TaskInput[] = [
      task({ id: "urgent", remainingMinutes: 60, deadline: local(2026, 6, 1, 9, 0), minChunkMinutes: 60, maxChunkMinutes: 60, splittable: false }),
      task({ id: "someday", remainingMinutes: 60, deadline: null, minChunkMinutes: 60, maxChunkMinutes: 60, splittable: false }),
    ];

    const result = solveCore({ ...baseInput, now, blocks, tasks });

    expect(result.unplaceable).toHaveLength(0);
    const urgent = result.placements.find((p) => p.taskId === "urgent")!;
    const someday = result.placements.find((p) => p.taskId === "someday")!;
    expect(urgent.start.getTime()).toBeLessThan(someday.start.getTime());
  });

  it("flags a placed task as at-risk when its slack is under 120 minutes, and not otherwise", () => {
    const now = local(2026, 6, 1, 8, 0);
    const horizonEnd = local(2026, 6, 2, 0, 0);
    const blocks = makeBlocks(now, horizonEnd);

    const tasks: TaskInput[] = [
      // deadline +180m, 90m of work: slack = 180 - 90 = 90 < 120 → at risk.
      task({ id: "tight", remainingMinutes: 90, deadline: local(2026, 6, 1, 11, 0), minChunkMinutes: 90, maxChunkMinutes: 90, splittable: false }),
      // deadline +300m, 60m of work: slack = 300 - 60 = 240 >= 120 → comfortable.
      task({ id: "comfortable", remainingMinutes: 60, deadline: local(2026, 6, 1, 13, 0), minChunkMinutes: 60, maxChunkMinutes: 60, splittable: false }),
    ];

    const result = solveCore({ ...baseInput, now, blocks, tasks });

    expect(result.unplaceable).toHaveLength(0);
    expect(result.atRisk.some((r) => r.taskId === "tight")).toBe(true);
    expect(result.atRisk.some((r) => r.taskId === "comfortable")).toBe(false);
  });
});

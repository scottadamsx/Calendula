import type { Block } from "./grid";
import type { EnergyLabel } from "./types";

/**
 * Pure least-slack-time solver (spec §7.2, §7.3). No DB access — see solve.ts
 * for the wrapper matching the spec's exact `solve()` signature. Operates on
 * an already-built grid (mutated in place: placed blocks flip to 'soft').
 */

export interface TaskInput {
  id: string;
  categoryId: string | null;
  title: string;
  remainingMinutes: number;
  deadline: Date | null;
  priority: number;
  minChunkMinutes: number;
  maxChunkMinutes: number;
  splittable: boolean;
  preferredLabels: EnergyLabel[];
}

export interface PlacedChunk {
  taskId: string;
  start: Date;
  end: Date;
}

export interface SolveCoreInput {
  now: Date;
  timezone: string;
  blocks: Block[];
  tasks: TaskInput[];
  /** Where each task was placed on the previous run — for the movement penalty. */
  previousByTaskId: Map<string, { start: Date; end: Date }>;
  /** Duration-calibration multiplier per category (spec §12); default 1.0 if absent. */
  calibrationByCategory: Map<string, number>;
  maxTaskMinutesPerDay: number;
  minBreakMinutes: number;
  movementPenalty: number;
}

export interface SolveCoreResult {
  placements: PlacedChunk[];
  unplaceable: { taskId: string; remainingMinutes: number; deadline: Date | null }[];
  atRisk: { taskId: string; slackMinutes: number }[];
  movedCount: number;
}

interface CandidateTask extends TaskInput {
  remaining: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dayKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function slackMinutesFor(task: CandidateTask, now: Date, calibration: Map<string, number>): number {
  if (!task.deadline) return Number.POSITIVE_INFINITY;
  const multiplier = task.categoryId ? (calibration.get(task.categoryId) ?? 1.0) : 1.0;
  const deadlineMinutes = (task.deadline.getTime() - now.getTime()) / 60_000;
  return deadlineMinutes - task.remaining * multiplier;
}

interface SlotCandidate {
  startIndex: number;
  length: number;
  start: Date;
  end: Date;
}

/** Contiguous runs of free, non-frozen blocks — the only spans a task can ever land in. */
function freeRuns(blocks: Block[]): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let runStart: number | null = null;

  for (let i = 0; i < blocks.length; i++) {
    const eligible = blocks[i].state === "free" && !blocks[i].frozen;
    if (eligible && runStart === null) {
      runStart = i;
    } else if (!eligible && runStart !== null) {
      runs.push({ start: runStart, end: i });
      runStart = null;
    }
  }
  if (runStart !== null) runs.push({ start: runStart, end: blocks.length });

  return runs;
}

function candidateSlotsInRun(
  blocks: Block[],
  run: { start: number; end: number },
  blocksNeeded: number,
  minBreakBlocks: number,
): SlotCandidate[] {
  const runLength = run.end - run.start;
  const candidates: SlotCandidate[] = [];

  for (let offset = 0; offset + blocksNeeded <= runLength; offset++) {
    const startIndex = run.start + offset;
    const before = offset;
    const after = runLength - offset - blocksNeeded;

    // Hard reject: a leftover sliver on either side smaller than the
    // minimum break is worse than no slot at all (spec §7.3).
    if (before > 0 && before < minBreakBlocks) continue;
    if (after > 0 && after < minBreakBlocks) continue;

    candidates.push({
      startIndex,
      length: blocksNeeded,
      start: blocks[startIndex].start,
      end: blocks[startIndex + blocksNeeded - 1].end,
    });
  }

  return candidates;
}

function labelMatch(blocks: Block[], startIndex: number, length: number, preferred: EnergyLabel[]): number {
  if (preferred.length === 0) return 0;
  let matches = 0;
  for (let i = startIndex; i < startIndex + length; i++) {
    if (blocks[i].labels.some((l) => preferred.includes(l))) matches++;
  }
  return matches / length;
}

function meanQuality(blocks: Block[], startIndex: number, length: number): number {
  let sum = 0;
  for (let i = startIndex; i < startIndex + length; i++) sum += blocks[i].quality;
  return sum / length;
}

function deadlineProximity(slotStart: Date, now: Date, deadline: Date | null): number {
  if (!deadline) return 0;
  const total = deadline.getTime() - now.getTime();
  if (total <= 0) return 0;
  const fromNow = slotStart.getTime() - now.getTime();
  return clamp(1 - fromNow / total, 0, 1);
}

function fragmentation(before: number, after: number, minBreakBlocks: number): number {
  // Legal leftovers are already only 0 or >= minBreak (freeRuns filtered the
  // rest out) — a small-but-legal leftover still packs worse than a clean
  // fit, so it's a soft penalty, not a hard rejection.
  let penalty = 0;
  if (before > 0 && before < 2 * minBreakBlocks) penalty += 0.5;
  if (after > 0 && after < 2 * minBreakBlocks) penalty += 0.5;
  return penalty;
}

function dailyOverload(
  day: string,
  addingMinutes: number,
  dailyMinutesUsed: Map<string, number>,
  maxTaskMinutesPerDay: number,
): number {
  const used = dailyMinutesUsed.get(day) ?? 0;
  return (used + addingMinutes) / maxTaskMinutesPerDay;
}

export function solveCore(input: SolveCoreInput): SolveCoreResult {
  const {
    now,
    timezone,
    blocks,
    tasks,
    previousByTaskId,
    calibrationByCategory,
    maxTaskMinutesPerDay,
    minBreakMinutes,
    movementPenalty,
  } = input;

  const blockMinutes = blocks.length > 0
    ? (blocks[0].end.getTime() - blocks[0].start.getTime()) / 60_000
    : 15;
  const minBreakBlocks = Math.max(1, Math.ceil(minBreakMinutes / blockMinutes));

  const candidates: CandidateTask[] = tasks
    .filter((t) => t.remainingMinutes > 0)
    .map((t) => ({ ...t, remaining: t.remainingMinutes }));

  const placements: PlacedChunk[] = [];
  const unplaceable: SolveCoreResult["unplaceable"] = [];
  const lastSlackByTaskId = new Map<string, number>();
  const dailyMinutesUsed = new Map<string, number>();
  let movedCount = 0;
  const alreadyCountedAsMoved = new Set<string>();

  while (candidates.length > 0) {
    for (const c of candidates) {
      lastSlackByTaskId.set(c.id, slackMinutesFor(c, now, calibrationByCategory));
    }

    candidates.sort((a, b) => {
      const slackDiff = lastSlackByTaskId.get(a.id)! - lastSlackByTaskId.get(b.id)!;
      if (slackDiff !== 0) return slackDiff;
      return b.priority - a.priority;
    });

    const head = candidates[0];
    const desiredChunk = head.splittable
      ? clamp(head.remaining, head.minChunkMinutes, head.maxChunkMinutes)
      : head.remaining;
    const blocksNeeded = Math.ceil(desiredChunk / blockMinutes);

    const runs = freeRuns(blocks);
    let best: { slot: SlotCandidate; score: number } | null = null;

    for (const run of runs) {
      const slots = candidateSlotsInRun(blocks, run, blocksNeeded, minBreakBlocks);
      for (const slot of slots) {
        if (head.deadline && slot.end.getTime() > head.deadline.getTime()) continue;

        const day = dayKey(slot.start, timezone);
        const chunkMinutes = blocksNeeded * blockMinutes;
        if (dailyOverload(day, chunkMinutes, dailyMinutesUsed, maxTaskMinutesPerDay) > 1) continue;

        const before = slot.startIndex - run.start;
        const after = run.end - (slot.startIndex + slot.length);

        const previous = previousByTaskId.get(head.id);
        const movedPenalty =
          previous && (previous.start.getTime() !== slot.start.getTime() || previous.end.getTime() !== slot.end.getTime())
            ? movementPenalty
            : 0;

        const score =
          1.0 * meanQuality(blocks, slot.startIndex, slot.length) +
          0.5 * labelMatch(blocks, slot.startIndex, slot.length, head.preferredLabels) +
          0.3 * deadlineProximity(slot.start, now, head.deadline) -
          movedPenalty -
          0.4 * fragmentation(before, after, minBreakBlocks) -
          0.6 * dailyOverload(day, chunkMinutes, dailyMinutesUsed, maxTaskMinutesPerDay);

        if (!best || score > best.score) best = { slot, score };
      }
    }

    if (!best) {
      unplaceable.push({
        taskId: head.id,
        remainingMinutes: head.remaining,
        deadline: head.deadline,
      });
      const idx = candidates.findIndex((c) => c.id === head.id);
      candidates.splice(idx, 1);
      continue;
    }

    const { slot } = best;
    for (let i = slot.startIndex; i < slot.startIndex + slot.length; i++) {
      blocks[i].state = "soft";
      blocks[i].sourceId = head.id;
      blocks[i].title = head.title;
    }
    placements.push({ taskId: head.id, start: slot.start, end: slot.end });

    const day = dayKey(slot.start, timezone);
    const chunkMinutes = slot.length * blockMinutes;
    dailyMinutesUsed.set(day, (dailyMinutesUsed.get(day) ?? 0) + chunkMinutes);

    const previous = previousByTaskId.get(head.id);
    if (
      previous &&
      (previous.start.getTime() !== slot.start.getTime() || previous.end.getTime() !== slot.end.getTime()) &&
      !alreadyCountedAsMoved.has(head.id)
    ) {
      movedCount++;
      alreadyCountedAsMoved.add(head.id);
    }

    head.remaining -= chunkMinutes;
    if (head.remaining <= 0) {
      const idx = candidates.findIndex((c) => c.id === head.id);
      candidates.splice(idx, 1);
    }
  }

  const unplaceableIds = new Set(unplaceable.map((u) => u.taskId));
  const atRisk: SolveCoreResult["atRisk"] = [];
  for (const [taskId, slack] of lastSlackByTaskId) {
    if (unplaceableIds.has(taskId)) continue;
    if (Number.isFinite(slack) && slack < 120) {
      atRisk.push({ taskId, slackMinutes: slack });
    }
  }

  return { placements, unplaceable, atRisk, movedCount };
}

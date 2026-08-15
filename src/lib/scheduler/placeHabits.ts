import { DateTime } from "luxon";
import type { Block } from "./grid";
import type { EnergyLabel } from "./types";

/**
 * Pure habit pass (spec §7.4) — runs after the task pass, against whatever
 * blocks the task solver left free. No DB access — see solve.ts.
 */

export interface HabitInput {
  id: string;
  title: string;
  durationMinutes: number;
  targetSessionsPerWeek: number;
  minSpacingHours: number;
  preferredLabels: EnergyLabel[];
  earliestTime: string | null; // "HH:mm"
  latestTime: string | null;
}

export interface HabitSession {
  habitId: string;
  start: Date;
  end: Date;
}

export interface PlaceHabitsInput {
  now: Date;
  horizonEnd: Date;
  timezone: string;
  blocks: Block[];
  habits: HabitInput[];
  /** Sessions already on the grid for a habit (e.g. frozen, preserved from a previous run). */
  existingSessionsByHabitId: Map<string, HabitSession[]>;
}

export interface PlaceHabitsResult {
  placements: HabitSession[];
  shortfall: { habitId: string; missing: number }[];
}

function weekWindows(from: Date, to: Date, timezone: string): { start: DateTime; end: DateTime }[] {
  const windows: { start: DateTime; end: DateTime }[] = [];
  let cursor = DateTime.fromJSDate(from, { zone: timezone }).startOf("week");
  const end = DateTime.fromJSDate(to, { zone: timezone });
  while (cursor < end) {
    windows.push({ start: cursor, end: cursor.plus({ weeks: 1 }) });
    cursor = cursor.plus({ weeks: 1 });
  }
  return windows;
}

function withinTimeOfDay(block: Block, earliest: string | null, latest: string | null, timezone: string): boolean {
  if (!earliest && !latest) return true;
  const time = DateTime.fromJSDate(block.start, { zone: timezone }).toFormat("HH:mm");
  if (earliest && time < earliest) return false;
  if (latest && time >= latest) return false;
  return true;
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (60 * 60_000);
}

function meanQuality(blocks: Block[], startIndex: number, length: number): number {
  let sum = 0;
  for (let i = startIndex; i < startIndex + length; i++) sum += blocks[i].quality;
  return sum / length;
}

function labelMatch(blocks: Block[], startIndex: number, length: number, preferred: EnergyLabel[]): number {
  if (preferred.length === 0) return 0;
  let matches = 0;
  for (let i = startIndex; i < startIndex + length; i++) {
    if (blocks[i].labels.some((l) => preferred.includes(l))) matches++;
  }
  return matches / length;
}

export function placeHabits(input: PlaceHabitsInput): PlaceHabitsResult {
  const { timezone, blocks, habits, existingSessionsByHabitId } = input;
  const blockMinutes = blocks.length > 0
    ? (blocks[0].end.getTime() - blocks[0].start.getTime()) / 60_000
    : 15;

  const placements: HabitSession[] = [];
  const shortfallByHabit = new Map<string, number>();

  for (const habit of habits) {
    const blocksNeeded = Math.ceil(habit.durationMinutes / blockMinutes);
    const sessionsThisHabit = [...(existingSessionsByHabitId.get(habit.id) ?? [])];

    for (const week of weekWindows(input.now, input.horizonEnd, timezone)) {
      const alreadyThisWeek = sessionsThisHabit.filter(
        (s) => DateTime.fromJSDate(s.start, { zone: timezone }) >= week.start
          && DateTime.fromJSDate(s.start, { zone: timezone }) < week.end,
      ).length;
      const needed = habit.targetSessionsPerWeek - alreadyThisWeek;

      for (let i = 0; i < needed; i++) {
        let best: { startIndex: number; score: number } | null = null;

        for (let startIndex = 0; startIndex + blocksNeeded <= blocks.length; startIndex++) {
          const start = blocks[startIndex].start;
          const end = blocks[startIndex + blocksNeeded - 1].end;

          if (start < week.start.toJSDate() || end > week.end.toJSDate()) continue;

          let eligible = true;
          for (let i2 = startIndex; i2 < startIndex + blocksNeeded; i2++) {
            if (blocks[i2].state !== "free" || blocks[i2].frozen) { eligible = false; break; }
            if (!withinTimeOfDay(blocks[i2], habit.earliestTime, habit.latestTime, timezone)) { eligible = false; break; }
          }
          if (!eligible) continue;

          const nearestGapHours = sessionsThisHabit.length > 0
            ? Math.min(...sessionsThisHabit.map((s) => Math.min(hoursBetween(start, s.start), hoursBetween(start, s.end))))
            : Infinity;
          if (nearestGapHours < habit.minSpacingHours) continue;

          const spacingBonus = Number.isFinite(nearestGapHours)
            ? Math.min(nearestGapHours / (habit.minSpacingHours * 2), 1)
            : 1;

          const score =
            1.0 * meanQuality(blocks, startIndex, blocksNeeded) +
            0.5 * labelMatch(blocks, startIndex, blocksNeeded, habit.preferredLabels) +
            0.3 * spacingBonus;

          if (!best || score > best.score) best = { startIndex, score };
        }

        if (!best) {
          shortfallByHabit.set(habit.id, (shortfallByHabit.get(habit.id) ?? 0) + (needed - i));
          break;
        }

        const start = blocks[best.startIndex].start;
        const end = blocks[best.startIndex + blocksNeeded - 1].end;
        for (let i2 = best.startIndex; i2 < best.startIndex + blocksNeeded; i2++) {
          blocks[i2].state = "soft";
          blocks[i2].sourceId = habit.id;
          blocks[i2].title = habit.title;
        }
        const session = { habitId: habit.id, start, end };
        placements.push(session);
        sessionsThisHabit.push(session);
      }
    }
  }

  return {
    placements,
    shortfall: [...shortfallByHabit.entries()].map(([habitId, missing]) => ({ habitId, missing })),
  };
}

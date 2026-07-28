import { DateTime } from "luxon";
import type { EnergyLabel } from "./types";

/** Pure grid construction (spec §6). No DB access here — see buildGrid.ts. */

export type BlockState = "unavailable" | "free" | "soft" | "hard" | "tentative";

export interface Block {
  start: Date;
  end: Date;
  state: BlockState;
  quality: number;
  labels: EnergyLabel[];
  sourceId?: string;
  title?: string;
  location?: string;
  frozen: boolean;
}

export interface PlacementInput {
  sourceId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  hardness: "hard" | "soft" | "tentative";
  pinned: boolean;
  location: string | null;
  travelBufferMinutes: number;
}

export interface EnergyWindowInput {
  /** JS `Date.getDay()` convention: 0 = Sunday … 6 = Saturday. null = every day. */
  dayOfWeek: number | null;
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  quality: number;
  label: EnergyLabel;
}

export interface GridInput {
  from: Date;
  to: Date;
  now: Date;
  timezone: string;
  blockMinutes: number;
  sleepStart: string; // "HH:mm"
  sleepEnd: string;
  freezeWindowHours: number;
  placements: PlacementInput[];
  energyWindows: EnergyWindowInput[];
}

/** Handles ranges that wrap midnight (e.g. sleep 23:30–07:30). */
function isWithinWrappingRange(time: string, start: string, end: string): boolean {
  if (start <= end) return time >= start && time < end;
  return time >= start || time < end;
}

function overlaps(blockStart: Date, blockEnd: Date, rangeStart: Date, rangeEnd: Date): boolean {
  return blockStart < rangeEnd && blockEnd > rangeStart;
}

export function computeGrid(input: GridInput): Block[] {
  const zone = input.timezone;
  const blocks: Block[] = [];

  // 1. Slice in local wall time, then convert to UTC instants — this order
  // is what makes the grid DST-correct: a 15-minute step in wall-clock terms
  // is not always a 15-minute step in UTC across a spring-forward/fall-back
  // boundary, and stepping in UTC would silently misalign block boundaries
  // against the user's actual day.
  //
  // The start is snapped down to the nearest blockMinutes boundary (e.g. the
  // nearest :00/:15/:30/:45) rather than starting exactly at `from`. Every
  // caller passes `now` as `from`, and `now` lands at a different second
  // every time — without snapping, two grids built a few minutes apart (two
  // separate solve() runs) get differently-phased blocks. A placement
  // inserted against one grid's phase and a second placement inserted
  // against another grid's phase can then both intersect the *same* block
  // under a third grid's phase (e.g. /week's render) without ever actually
  // overlapping each other in real time — which is exactly what tripped the
  // no-double-assignment invariant live: two unrelated tasks' placements,
  // a couple of minutes apart in reality, both touched one oddly-boundaried
  // block. Snapping makes every grid for a given `blockMinutes` share the
  // same universal phase, so this can't happen.
  const from = DateTime.fromJSDate(input.from, { zone });
  const snappedMinute = Math.floor(from.minute / input.blockMinutes) * input.blockMinutes;
  let cursor = from.set({ minute: snappedMinute, second: 0, millisecond: 0 });
  const horizonEnd = DateTime.fromJSDate(input.to, { zone });

  while (cursor < horizonEnd) {
    const blockEnd = cursor.plus({ minutes: input.blockMinutes });
    blocks.push({
      start: cursor.toJSDate(),
      end: blockEnd.toJSDate(),
      state: "free",
      quality: 0.5,
      labels: [],
      frozen: false,
    });
    cursor = blockEnd;
  }

  // 2. Sleep windows.
  for (const block of blocks) {
    const local = DateTime.fromJSDate(block.start, { zone });
    const time = local.toFormat("HH:mm");
    if (isWithinWrappingRange(time, input.sleepStart, input.sleepEnd)) {
      block.state = "unavailable";
    }
  }

  // 3. Placements — the only source of hard/soft/tentative state. A pinned
  // soft placement is treated as hard. Two placements claiming the same
  // block is the single invariant this system cannot tolerate (§6): it
  // means an upstream solver double-booked, and that must surface as a
  // thrown error here, never a silent overwrite.
  const claimedBy = new Map<number, string>();
  for (const placement of input.placements) {
    const effectiveHardness = placement.pinned && placement.hardness === "soft"
      ? "hard"
      : placement.hardness;

    blocks.forEach((block, index) => {
      if (!overlaps(block.start, block.end, placement.startsAt, placement.endsAt)) return;

      const existing = claimedBy.get(index);
      if (existing && existing !== placement.sourceId) {
        throw new Error(
          `Grid invariant violated: block ${block.start.toISOString()} claimed by both ` +
            `${existing} and ${placement.sourceId}`,
        );
      }
      claimedBy.set(index, placement.sourceId);

      block.state = effectiveHardness;
      block.sourceId = placement.sourceId;
      block.title = placement.title;
      if (placement.location) block.location = placement.location;
    });
  }

  // 4. Travel buffers — padding only; never overrides an actual placement.
  for (const placement of input.placements) {
    if (!placement.location || placement.travelBufferMinutes <= 0) continue;

    const bufferMs = placement.travelBufferMinutes * 60_000;
    const before = { start: new Date(placement.startsAt.getTime() - bufferMs), end: placement.startsAt };
    const after = { start: placement.endsAt, end: new Date(placement.endsAt.getTime() + bufferMs) };

    for (const block of blocks) {
      if (block.state !== "free") continue;
      if (
        overlaps(block.start, block.end, before.start, before.end) ||
        overlaps(block.start, block.end, after.start, after.end)
      ) {
        block.state = "unavailable";
      }
    }
  }

  // 5. Energy windows — quality/labels. Unmatched blocks keep the 0.5 default.
  for (const block of blocks) {
    const local = DateTime.fromJSDate(block.start, { zone });
    const time = local.toFormat("HH:mm");
    const dayOfWeek = local.toJSDate().getDay();

    const match = input.energyWindows.find(
      (w) =>
        (w.dayOfWeek === null || w.dayOfWeek === dayOfWeek) &&
        time >= w.startTime &&
        time < w.endTime,
    );
    if (match) {
      block.quality = match.quality;
      block.labels = [match.label];
    }
  }

  // 6. Freeze window — nothing inside it moves without confirmation (D7).
  const freezeUntil = input.now.getTime() + input.freezeWindowHours * 60 * 60_000;
  for (const block of blocks) {
    if (block.start.getTime() < freezeUntil) block.frozen = true;
  }

  return blocks;
}

export interface MergedPlacement {
  sourceId: string;
  title?: string;
  start: Date;
  end: Date;
  state: BlockState;
  location?: string;
}

/** Collapses contiguous same-source blocks back into single display items. */
export function mergeBySource(blocks: Block[]): MergedPlacement[] {
  const merged: MergedPlacement[] = [];

  for (const block of blocks) {
    if (!block.sourceId) continue;
    const last = merged[merged.length - 1];

    if (last && last.sourceId === block.sourceId && last.end.getTime() === block.start.getTime()) {
      last.end = block.end;
    } else {
      merged.push({
        sourceId: block.sourceId,
        title: block.title,
        start: block.start,
        end: block.end,
        state: block.state,
        location: block.location,
      });
    }
  }

  return merged;
}

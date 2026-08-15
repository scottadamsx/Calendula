import { DateTime } from "luxon";
import type { Block, MergedPlacement } from "./grid";
import type { EnergyLabel } from "./types";

/**
 * Pure pieces of the meeting offer engine (spec §9.1). The expensive part —
 * running a full dry-run solve per candidate for displacementCost — needs a
 * database and lives in findMeetingSlots.ts; everything here is candidate
 * generation and scoring, which doesn't.
 */

export type MeetingType = "social" | "work" | "call";

export interface MeetingCandidate {
  start: Date;
  end: Date;
  startIndex: number;
  length: number;
}

/**
 * Every start where the duration fits entirely in free|soft blocks,
 * pre-filtered to at most 20: free-block candidates first, then soft ones
 * ordered by ascending count of overlapping chunks (spec §7.5's performance
 * note) — cheaper-to-displace candidates get evaluated first.
 *
 * Day-diversity is enforced *here*, not just in selectGreedy's final pass —
 * a real bug found live: with 15-minute blocks, one wide-open day alone can
 * generate far more than 20 raw candidates, so a plain chronological cap
 * exhausted the whole budget on a single day and selectGreedy's "skip a day
 * already represented" rule had nothing left from any other day to pick.
 * "Day-spread is enforced, not optional" (spec §9.1) requires day-diversity
 * to survive this pre-filter, not just be attempted after it. Round-robins
 * across days instead of taking a flat top-20.
 */
export function findCandidateStarts(blocks: Block[], durationMinutes: number, timezone: string): MeetingCandidate[] {
  if (blocks.length === 0) return [];
  const blockMinutes = (blocks[0].end.getTime() - blocks[0].start.getTime()) / 60_000;
  const length = Math.ceil(durationMinutes / blockMinutes);

  const byDay = new Map<string, (MeetingCandidate & { softChunks: number })[]>();

  for (let i = 0; i + length <= blocks.length; i++) {
    let eligible = true;
    let touchesSoft = false;
    const sourceIds = new Set<string>();

    for (let j = i; j < i + length; j++) {
      const b = blocks[j];
      if (b.frozen || (b.state !== "free" && b.state !== "soft")) { eligible = false; break; }
      if (b.state === "soft") {
        touchesSoft = true;
        if (b.sourceId) sourceIds.add(b.sourceId);
      }
    }
    if (!eligible) continue;

    const start = blocks[i].start;
    const day = DateTime.fromJSDate(start, { zone: timezone }).toISODate() ?? "unknown";
    const list = byDay.get(day) ?? [];
    list.push({ start, end: blocks[i + length - 1].end, startIndex: i, length, softChunks: touchesSoft ? sourceIds.size : 0 });
    byDay.set(day, list);
  }

  for (const list of byDay.values()) list.sort((a, b) => a.softChunks - b.softChunks);

  const days = [...byDay.keys()].sort();
  const result: (MeetingCandidate & { softChunks: number })[] = [];
  let cursor = 0;
  while (result.length < 20 && days.some((d) => (byDay.get(d)?.length ?? 0) > cursor)) {
    for (const day of days) {
      const list = byDay.get(day)!;
      if (cursor < list.length) result.push(list[cursor]);
      if (result.length >= 20) break;
    }
    cursor++;
  }

  return result.map((c) => ({ start: c.start, end: c.end, startIndex: c.startIndex, length: c.length }));
}

/** 0 when the preceding placement has a different location and the gap is under its travel buffer; 1 otherwise. */
export function travelFeasible(
  candidateStart: Date,
  preceding: { location?: string; end: Date } | null,
  candidateLocation: string | null,
  precedingTravelBufferMinutes: number,
): number {
  if (!preceding || !preceding.location || !candidateLocation) return 1;
  if (preceding.location === candidateLocation) return 1;
  const gapMinutes = (candidateStart.getTime() - preceding.end.getTime()) / 60_000;
  return gapMinutes >= precedingTravelBufferMinutes ? 1 : 0;
}

const MEETING_TYPE_LABELS: Record<MeetingType, EnergyLabel[]> = {
  social: ["social"],
  work: ["admin", "deep"],
  call: ["admin"],
};

/** How well a candidate's energy labels suit the meeting type — 1 if any match, else 0. */
export function energyFit(labels: EnergyLabel[], meetingType: MeetingType): number {
  const preferred = MEETING_TYPE_LABELS[meetingType];
  return labels.some((l) => preferred.includes(l)) ? 1 : 0;
}

/** Rewards sooner candidates within the search horizon — same shape as the task solver's deadlineProximity. */
export function earliness(candidateStart: Date, now: Date, horizonEnd: Date): number {
  const total = horizonEnd.getTime() - now.getTime();
  if (total <= 0) return 0;
  const fromNow = candidateStart.getTime() - now.getTime();
  return Math.max(0, Math.min(1, 1 - fromNow / total));
}

function normalizeCost(costMinutes: number): number {
  return Math.max(0, Math.min(1, costMinutes / 240));
}

export function scoreCandidate(input: {
  costMinutes: number;
  labels: EnergyLabel[];
  meetingType: MeetingType;
  travel: number;
  candidateStart: Date;
  now: Date;
  horizonEnd: Date;
}): number {
  return (
    1.0 * (1 - normalizeCost(input.costMinutes)) +
    0.6 * energyFit(input.labels, input.meetingType) +
    0.5 * input.travel +
    0.2 * earliness(input.candidateStart, input.now, input.horizonEnd)
  );
}

/**
 * spec §7.5 references sumSlackDelta(baseline.atRisk, after.atRisk) without
 * defining it. Interpretation: for each task at risk *after* excluding the
 * candidate range, how much worse is its slack than before? A task not
 * previously at-risk is assumed to have been sitting right at the 120-minute
 * threshold, so its full drop below that counts as loss. A task whose slack
 * *improved* contributes nothing (excluding time from the grid can't help
 * anything, so this shouldn't occur in practice — treated as 0, not negative).
 */
export function sumSlackDelta(
  baselineAtRisk: { taskId: string; slackMinutes: number }[],
  afterAtRisk: { taskId: string; slackMinutes: number }[],
): number {
  const baselineByTask = new Map(baselineAtRisk.map((a) => [a.taskId, a.slackMinutes]));
  let totalLoss = 0;
  for (const after of afterAtRisk) {
    const before = baselineByTask.get(after.taskId) ?? 120;
    const loss = before - after.slackMinutes;
    if (loss > 0) totalLoss += loss;
  }
  return totalLoss;
}

export interface ScoredSlot {
  start: Date;
  end: Date;
  score: number;
}

/** Sort descending, skip any day already represented, take up to `count` (spec §9.1). */
export function selectGreedy<T extends ScoredSlot>(scored: T[], count: number, timezone: string): T[] {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const selected: T[] = [];
  const daysUsed = new Set<string>();

  for (const candidate of sorted) {
    if (selected.length >= count) break;
    const day = DateTime.fromJSDate(candidate.start, { zone: timezone }).toISODate();
    if (day && daysUsed.has(day)) continue;
    selected.push(candidate);
    if (day) daysUsed.add(day);
  }

  return selected;
}

/** The preceding placement in real time, for the travel-feasibility check. */
export function precedingPlacement(placements: MergedPlacement[], candidateStart: Date): MergedPlacement | null {
  let best: MergedPlacement | null = null;
  for (const p of placements) {
    if (p.end.getTime() <= candidateStart.getTime()) {
      if (!best || p.end.getTime() > best.end.getTime()) best = p;
    }
  }
  return best;
}

/**
 * spec §9.3: "the deliverable of this layer is pasteable text." The spec's
 * own example ("Thursday after 2, Friday morning...") implies an LLM polish
 * pass (design thesis: LLM lives at the edges) — not available without
 * ANTHROPIC_API_KEY (unset, see Settings), so this is the deterministic
 * fallback: plain, correct, always available, no model call required.
 * Upgrade path once a key exists: pass this same slot list to Haiku instead.
 */
export function formatOfferMessage(slots: { start: Date; end: Date }[], timezone: string): string {
  if (slots.length === 0) {
    return "I don't actually have anything open that works — let me get back to you.";
  }
  const parts = slots.map((s) => {
    const start = DateTime.fromJSDate(s.start, { zone: timezone });
    const end = DateTime.fromJSDate(s.end, { zone: timezone });
    return `${start.toFormat("cccc")} ${start.toFormat("h:mma").toLowerCase()}–${end.toFormat("h:mma").toLowerCase()}`;
  });
  const joined =
    parts.length === 1
      ? parts[0]
      : parts.length === 2
        ? `${parts[0]} or ${parts[1]}`
        : `${parts.slice(0, -1).join(", ")}, or ${parts[parts.length - 1]}`;
  return `${joined} all work for me, whichever's easiest.`;
}

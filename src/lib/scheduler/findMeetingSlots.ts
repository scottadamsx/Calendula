import { buildGrid } from "./buildGrid";
import { mergeBySource } from "./grid";
import { solve } from "./solve";
import {
  findCandidateStarts,
  travelFeasible,
  scoreCandidate,
  selectGreedy,
  precedingPlacement,
  sumSlackDelta,
  type MeetingType,
} from "./meetingOffers";
import type { EnergyLabel, Range, SolveResult } from "./types";

export interface MeetingSlot {
  start: Date;
  end: Date;
  score: number;
  /** The real displacementCost minutes — persisted to meeting_offer_slots.displacement_cost, distinct from the composite score. */
  costMinutes: number;
}

export interface FindMeetingSlotsOptions {
  durationMinutes: number;
  meetingType: MeetingType;
  horizonDays: number;
  count?: number; // default 3
  /**
   * Minor addition beyond the spec's literal §9.1 signature: meeting_offers
   * has no location column, and neither does the pinned opts interface, but
   * travelFeasible's own scoring term (the "downtown coffee at 4:15" example)
   * is meaningless without one. Optional and never persisted — used only to
   * score this search.
   */
  location?: string | null;
}

/** spec §7.5 — DB-touching (calls solve()), so it lives outside meetingOffers.ts's pure functions. */
export async function displacementCost(
  userId: string,
  range: Range,
  baseline: SolveResult,
): Promise<number | "BLOCKED"> {
  const after = await solve(userId, { dryRun: true, excludeRanges: [range] });
  if (after.unplaceable.length > baseline.unplaceable.length) return "BLOCKED";
  return sumSlackDelta(baseline.atRisk, after.atRisk);
}

/** spec §9.1. */
export async function findMeetingSlots(userId: string, opts: FindMeetingSlotsOptions): Promise<MeetingSlot[]> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const { data: profile, error: profileError } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone, freeze_window_hours")
    .eq("user_id", userId)
    .single();
  if (profileError || !profile) {
    throw new Error(`No calendula_scheduling_profile for user ${userId}; cannot find meeting slots.`);
  }

  const now = new Date();
  const searchFrom = new Date(now.getTime() + profile.freeze_window_hours * 60 * 60_000);
  const searchTo = new Date(now.getTime() + opts.horizonDays * 24 * 60 * 60_000);

  const blocks = await buildGrid(userId, searchFrom, searchTo);
  const candidates = findCandidateStarts(blocks, opts.durationMinutes, profile.timezone);
  const existingPlacements = mergeBySource(blocks);

  // travelFeasible needs the *preceding* placement's own travel buffer, which
  // MergedPlacement doesn't carry (spec §5.4/§5.6 — it lives on fixed_blocks/
  // habits, not placements). Fetch it for whichever sources are actually
  // relevant here rather than re-deriving buildGrid's whole lookup.
  const precedingSourceIds = [...new Set(existingPlacements.filter((p) => p.sourceType === "fixed").map((p) => p.sourceId))];
  const bufferBySourceId = new Map<string, number>();
  if (precedingSourceIds.length > 0) {
    const { data: fixedBlocks } = await supabase
      .from("calendula_fixed_blocks")
      .select("id, travel_buffer_minutes")
      .in("id", precedingSourceIds);
    for (const row of fixedBlocks ?? []) bufferBySourceId.set(row.id, row.travel_buffer_minutes);
  }

  // baseline computed once, per spec §7.5's performance note.
  const baseline = await solve(userId, { dryRun: true });

  const scored = (
    await Promise.all(
      candidates.map(async (candidate) => {
        const cost = await displacementCost(userId, { start: candidate.start, end: candidate.end }, baseline);
        if (cost === "BLOCKED") return null;

        const labels = new Set<EnergyLabel>();
        for (let i = candidate.startIndex; i < candidate.startIndex + candidate.length; i++) {
          for (const l of blocks[i].labels) labels.add(l);
        }

        const preceding = precedingPlacement(existingPlacements, candidate.start);
        const travel = travelFeasible(
          candidate.start,
          preceding,
          opts.location ?? null,
          preceding ? (bufferBySourceId.get(preceding.sourceId) ?? 0) : 0,
        );

        const score = scoreCandidate({
          costMinutes: cost,
          labels: [...labels],
          meetingType: opts.meetingType,
          travel,
          candidateStart: candidate.start,
          now,
          horizonEnd: searchTo,
        });

        return { start: candidate.start, end: candidate.end, score, costMinutes: cost };
      }),
    )
  ).filter((s): s is MeetingSlot => s !== null);

  return selectGreedy(scored, opts.count ?? 3, profile.timezone);
}

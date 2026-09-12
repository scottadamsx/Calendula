import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { expandFixedBlock, findFixedBlockConflict, type FixedBlockOccurrence } from "./fixedBlocks";

/**
 * The creation-time overlap guard, shared by create and update. Checks the
 * far horizon (not just horizon_days) since a weekly block can land inside a
 * one-off many weeks out. Returns a user-facing message naming the conflict,
 * or null when the candidate is clear. `excludeId` lets an update ignore the
 * block's own current occurrences.
 */
export async function describeFixedBlockConflict(
  supabase: SupabaseClient,
  userId: string,
  profile: { timezone: string; far_horizon_days: number },
  candidate: { startsAt: Date; endsAt: Date; rrule: string | null },
  excludeId?: string,
): Promise<string | null> {
  const checkFrom = new Date();
  const checkTo = new Date(checkFrom.getTime() + profile.far_horizon_days * 24 * 60 * 60_000);

  const { data: existingBlocks, error } = await supabase
    .from("calendula_fixed_blocks")
    .select("id, title, starts_at, ends_at, rrule")
    .eq("user_id", userId);
  if (error) throw error;

  const existingOccurrences: FixedBlockOccurrence[] = (existingBlocks ?? [])
    .filter((b) => b.id !== excludeId)
    .flatMap((b) =>
      expandFixedBlock(
        { id: b.id, startsAt: new Date(b.starts_at), endsAt: new Date(b.ends_at), rrule: b.rrule },
        profile.timezone,
        checkFrom,
        checkTo,
      ).map((o) => ({ title: b.title, start: o.start, end: o.end })),
    );

  const candidateOccurrences = expandFixedBlock({ id: "candidate", ...candidate }, profile.timezone, checkFrom, checkTo);
  const conflict = findFixedBlockConflict(candidateOccurrences, existingOccurrences);
  if (!conflict) return null;
  const when = DateTime.fromJSDate(conflict.start, { zone: profile.timezone }).toFormat("ccc LLL d, h:mma");
  return `That overlaps "${conflict.title}" (${when}${candidate.rrule ? ", and every week it repeats" : ""}). Pick a different time.`;
}

import { RRule } from "rrule";
import { DateTime } from "luxon";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import type { Range } from "./types";

export interface FixedBlockInput {
  id: string;
  startsAt: Date;
  endsAt: Date;
  rrule: string | null;
}

/**
 * Expands a fixed_blocks row into concrete occurrences within [from, to)
 * (spec §16 Phase 1 acceptance: "14 days render correctly across a DST
 * boundary" — this is the function that has to get that right, not the
 * grid, since a class at "9am Monday" must stay 9am *local* through a
 * spring-forward/fall-back shift even though its UTC offset changes).
 *
 * `rrule`'s own DST handling for a plain `dtstart` is UTC-instant based, so
 * BYDAY/FREQ math done directly against real UTC timestamps drifts by the
 * DST delta once the horizon crosses one. The fix: run RRule against a
 * "floating" UTC Date whose Y-M-D-H-M fields are copied from the *local*
 * wall clock, so its calendar-day arithmetic is correct by construction,
 * then reinterpret each result's fields back as local time in the real zone.
 */
export function expandFixedBlock(
  block: FixedBlockInput,
  timezone: string,
  from: Date,
  to: Date,
): Range[] {
  const localStart = DateTime.fromJSDate(block.startsAt, { zone: timezone });
  const localEnd = DateTime.fromJSDate(block.endsAt, { zone: timezone });
  const durationMs = localEnd.toMillis() - localStart.toMillis();

  if (!block.rrule) {
    return block.startsAt < to && block.endsAt > from
      ? [{ start: block.startsAt, end: block.endsAt }]
      : [];
  }

  const floatingDtStart = floatingFromLocal(localStart);
  const floatingFrom = floatingFromLocal(DateTime.fromJSDate(from, { zone: timezone }));
  const floatingTo = floatingFromLocal(DateTime.fromJSDate(to, { zone: timezone }));

  const parsed = RRule.parseString(block.rrule);
  const rule = new RRule({ ...parsed, dtstart: floatingDtStart });
  const floatingOccurrences = rule.between(floatingFrom, floatingTo, true);

  return floatingOccurrences.map((floating) => {
    const local = localFromFloating(floating, timezone);
    const start = local.toJSDate();
    return { start, end: new Date(start.getTime() + durationMs) };
  });
}

export interface FixedBlockOccurrence {
  title: string;
  start: Date;
  end: Date;
}

/**
 * Pure range-overlap check across two expanded-occurrence lists. Used to
 * reject a new fixed block at creation time when it would overlap an
 * existing one, rather than letting both reach `placements` and trip the
 * grid engine's "two placements can't claim the same block" invariant —
 * that invariant exists to catch solver bugs, not to gracefully handle a
 * user creating two genuinely-overlapping manual commitments, and letting
 * it fire on real user data crashes the whole page instead of asking for
 * a different time. Returns the *first* conflicting existing occurrence
 * (by candidate-then-existing scan order) so the caller can name it.
 */
export function findFixedBlockConflict(
  candidateOccurrences: Range[],
  existingOccurrences: FixedBlockOccurrence[],
): FixedBlockOccurrence | null {
  for (const candidate of candidateOccurrences) {
    for (const existing of existingOccurrences) {
      if (candidate.start < existing.end && candidate.end > existing.start) {
        return existing;
      }
    }
  }
  return null;
}

function floatingFromLocal(dt: DateTime): Date {
  return new Date(Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second));
}

function localFromFloating(floating: Date, timezone: string): DateTime {
  return DateTime.fromObject(
    {
      year: floating.getUTCFullYear(),
      month: floating.getUTCMonth() + 1,
      day: floating.getUTCDate(),
      hour: floating.getUTCHours(),
      minute: floating.getUTCMinutes(),
      second: floating.getUTCSeconds(),
    },
    { zone: timezone },
  );
}

/**
 * Ingestion-time sync: expands every `fixed_blocks` row for `userId` into
 * `placements` rows for [from, to). This is the resolution to the SPEC-GAP
 * in CLAUDE.md — nothing in the spec says how a recurring fixed_blocks row
 * reaches the grid engine, which reads only `placements` (D11). Idempotent
 * via upsert on (user_id, source_type, source_id, starts_at); safe to re-run
 * over the same horizon (e.g. from a nightly cron, per D2's full-horizon
 * recompute philosophy) without duplicating rows.
 *
 * Uses the service-role client deliberately: this is background ingestion,
 * not a request served on behalf of one browser session, so there's no
 * cookie-bound auth.uid() to scope RLS against.
 */
export async function syncFixedBlockPlacements(
  userId: string,
  from: Date,
  to: Date,
): Promise<{ synced: number }> {
  const supabase = createServiceRoleClient();

  const { data: profile, error: profileError } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone")
    .eq("user_id", userId)
    .single();

  if (profileError || !profile) {
    // Never assume a timezone (spec §4, §5.1) — a missing profile is a real
    // error, not a reason to fall back to a default.
    throw new Error(`No calendula_scheduling_profile for user ${userId}; cannot sync fixed blocks.`);
  }

  const { data: fixedBlocks, error: blocksError } = await supabase
    .from("calendula_fixed_blocks")
    .select("id, title, starts_at, ends_at, rrule, location, travel_buffer_minutes")
    .eq("user_id", userId);

  if (blocksError) throw blocksError;

  const rows = (fixedBlocks ?? []).flatMap((block) => {
    const occurrences = expandFixedBlock(
      {
        id: block.id,
        startsAt: new Date(block.starts_at),
        endsAt: new Date(block.ends_at),
        rrule: block.rrule,
      },
      profile.timezone,
      from,
      to,
    );

    return occurrences.map((occurrence) => ({
      user_id: userId,
      source_type: "fixed" as const,
      source_id: block.id,
      title: block.title,
      starts_at: occurrence.start.toISOString(),
      ends_at: occurrence.end.toISOString(),
      hardness: "hard" as const,
      location: block.location,
    }));
  });

  // Every current occurrence's starts_at, per block — including blocks with
  // zero occurrences in [from, to) right now, so their previously-synced
  // placements still get cleaned up below.
  const validStartsAtByBlock = new Map<string, Set<number>>();
  for (const block of fixedBlocks ?? []) validStartsAtByBlock.set(block.id, new Set());
  for (const r of rows) validStartsAtByBlock.get(r.source_id)!.add(new Date(r.starts_at).getTime());

  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from("calendula_placements")
      .upsert(rows, { onConflict: "user_id,source_type,source_id,starts_at" });
    if (upsertError) throw upsertError;
  }

  // A real bug found live: when a block's time changes (an edit to its
  // start time) or an rrule occurrence stops applying, the upsert above
  // can't clean up the *old* placement — its starts_at changed, so it's a
  // different conflict key, not the same row being replaced. Left alone,
  // the grid ends up with both the stale and the current occurrence as
  // separate hard commitments. Sweeps every block's placements in-window
  // and removes whichever ones no longer match a currently-valid
  // occurrence. Comparison is by parsed timestamp, not raw string — Postgres
  // returns `starts_at` as `...+00:00`, which never string-equals JS's own
  // `...Z` `toISOString()` output (the exact bug class already hit once in
  // Phase 4's meeting-offer slots).
  for (const [blockId, validTimes] of validStartsAtByBlock) {
    const { data: existingForBlock, error: existingError } = await supabase
      .from("calendula_placements")
      .select("id, starts_at")
      .eq("user_id", userId)
      .eq("source_type", "fixed")
      .eq("source_id", blockId)
      .gte("starts_at", from.toISOString())
      .lt("starts_at", to.toISOString());
    if (existingError) throw existingError;

    const staleIds = (existingForBlock ?? [])
      .filter((p) => !validTimes.has(new Date(p.starts_at).getTime()))
      .map((p) => p.id);
    if (staleIds.length > 0) {
      const { error: deleteError } = await supabase.from("calendula_placements").delete().in("id", staleIds);
      if (deleteError) throw deleteError;
    }
  }

  return { synced: rows.length };
}

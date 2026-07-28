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

  if (rows.length === 0) return { synced: 0 };

  const { error: upsertError } = await supabase
    .from("calendula_placements")
    .upsert(rows, { onConflict: "user_id,source_type,source_id,starts_at" });

  if (upsertError) throw upsertError;
  return { synced: rows.length };
}

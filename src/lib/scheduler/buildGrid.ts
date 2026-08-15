import { createClient } from "@/lib/supabase/server";
import { computeGrid, type Block, type SourceType } from "./grid";
import type { EnergyLabel } from "./types";

/**
 * DB-reading wrapper matching the spec §6 signature exactly. Uses the
 * cookie-bound server client (not the service-role one) so RLS scopes every
 * read to the caller's own `auth.uid()` — this runs inside a request made on
 * behalf of a logged-in browser session, unlike the fixed-block sync cron.
 */
export async function buildGrid(userId: string, from: Date, to: Date): Promise<Block[]> {
  const supabase = await createClient();

  const { data: profile, error: profileError } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone, sleep_start, sleep_end, block_minutes, freeze_window_hours")
    .eq("user_id", userId)
    .single();

  if (profileError || !profile) {
    throw new Error(`No calendula_scheduling_profile for user ${userId}; cannot build a grid.`);
  }

  const { data: placements, error: placementsError } = await supabase
    .from("calendula_placements")
    .select("source_id, source_type, title, starts_at, ends_at, hardness, pinned, location")
    .eq("user_id", userId)
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString());

  if (placementsError) throw placementsError;

  // Travel buffer minutes live on fixed_blocks/habits, not placements — join
  // them in for any placement sourced from a fixed block. Tasks/habits/holds
  // don't carry travel buffers in the spec's schema.
  const fixedSourceIds = (placements ?? [])
    .filter((p) => p.location)
    .map((p) => p.source_id);

  const bufferBySourceId = new Map<string, number>();
  if (fixedSourceIds.length > 0) {
    const { data: fixedBlocks, error: fixedError } = await supabase
      .from("calendula_fixed_blocks")
      .select("id, travel_buffer_minutes")
      .in("id", fixedSourceIds);
    if (fixedError) throw fixedError;
    for (const row of fixedBlocks ?? []) {
      bufferBySourceId.set(row.id, row.travel_buffer_minutes);
    }
  }

  const { data: energyWindows, error: energyError } = await supabase
    .from("calendula_energy_windows")
    .select("day_of_week, start_time, end_time, quality, label")
    .eq("user_id", userId);

  if (energyError) throw energyError;

  return computeGrid({
    from,
    to,
    now: new Date(),
    timezone: profile.timezone,
    blockMinutes: profile.block_minutes,
    sleepStart: profile.sleep_start,
    sleepEnd: profile.sleep_end,
    freezeWindowHours: profile.freeze_window_hours,
    placements: (placements ?? []).map((p) => ({
      sourceId: p.source_id,
      sourceType: p.source_type as SourceType,
      title: p.title,
      startsAt: new Date(p.starts_at),
      endsAt: new Date(p.ends_at),
      hardness: p.hardness as "hard" | "soft" | "tentative",
      pinned: p.pinned,
      location: p.location,
      travelBufferMinutes: bufferBySourceId.get(p.source_id) ?? 0,
    })),
    energyWindows: (energyWindows ?? []).map((w) => ({
      dayOfWeek: w.day_of_week,
      startTime: w.start_time,
      endTime: w.end_time,
      quality: w.quality,
      label: w.label as EnergyLabel,
    })),
  });
}

import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { expandFixedBlock } from "./fixedBlocks";
import { deadlineProximityWeight, projectedLoadCore } from "./futureWindows";

/**
 * spec §8.1's default for "any high_exertion placement adds load across the
 * following buffer_after_hours" — `fixed_blocks` carries `high_exertion`
 * but has no buffer duration column of its own (`buffer_after_hours` only
 * exists on `activity_types`, used by `activity_holds`). Genuine spec
 * ambiguity, resolved rather than escalated (a formula default, not a
 * missing subsystem — same tier as `effectiveDeadline`, not Phase 4.6's
 * push decision). 24 hours: a full day of reduced capacity, and already the
 * project's own established "one day" unit (`freeze_window_hours` default).
 */
const DEFAULT_FIXED_BLOCK_RECOVERY_HOURS = 24;

/** Distributes `hours` of load starting at `rangeStart` across whichever local calendar day(s) it touches. */
function allocateHoursAcrossDays(rangeStart: Date, hours: number, timezone: string): Map<string, number> {
  const result = new Map<string, number>();
  if (hours <= 0) return result;

  let cursor = DateTime.fromJSDate(rangeStart, { zone: timezone });
  let remaining = hours;
  while (remaining > 0.0001) {
    const dayEnd = cursor.endOf("day");
    const hoursLeftInDay = Math.min(remaining, dayEnd.diff(cursor, "hours").hours);
    const key = cursor.toISODate() ?? "";
    result.set(key, (result.get(key) ?? 0) + hoursLeftInDay);
    remaining -= hoursLeftInDay;
    cursor = dayEnd.plus({ milliseconds: 1 });
  }
  return result;
}

function addTo(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

export interface ProjectedLoadByRange {
  loadByDay: Map<string, number>;
  /** True for any day touching an actual hard placement — §8.2's window-search reject filter. */
  hardDayFlags: Map<string, boolean>;
  /**
   * The deadline-pressure component alone, normalised the same way as
   * `loadByDay` (against the 10-waking-hour baseline) so it's on a
   * comparable [0,1]-ish scale — §8.2's `deadlinePenalty` needs this
   * specific component ("max deadline pressure in the 3 days following"),
   * not the full blended load `loadByDay` carries.
   */
  deadlinePressureByDay: Map<string, number>;
}

/**
 * DB wrapper for spec §8.1 — returns projected load (0..1) for every day in
 * [from, to]. Runs at day granularity over a potentially far horizon
 * (months out), so fixed_blocks are expanded fresh via `expandFixedBlock`
 * (pure, no DB) rather than read back from `placements` — the placements
 * sync cron only carries a much shorter horizon (spec §16's Phase 1 gap
 * resolution), and re-deriving avoids either inflating that table with
 * months of speculative rows or under-counting hard commitments beyond
 * whatever's already synced.
 */
export async function computeProjectedLoadForRange(
  userId: string,
  from: Date,
  to: Date,
  client?: SupabaseClient,
): Promise<ProjectedLoadByRange> {
  const supabase = client ?? (await createClient());

  const { data: profile, error: profileError } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone")
    .eq("user_id", userId)
    .single();
  if (profileError || !profile) {
    throw new Error(`No calendula_scheduling_profile for user ${userId}; cannot compute projected load.`);
  }
  const timezone = profile.timezone;

  const [
    { data: fixedBlocks, error: fixedError },
    { data: hardPlacements, error: placementsError },
    { data: tasks, error: tasksError },
    { data: activityHolds, error: holdsError },
    { data: activityTypes, error: typesError },
  ] = await Promise.all([
    supabase.from("calendula_fixed_blocks").select("id, starts_at, ends_at, rrule, high_exertion").eq("user_id", userId),
    supabase
      .from("calendula_placements")
      .select("starts_at, ends_at")
      .eq("user_id", userId)
      .eq("hardness", "hard")
      .neq("source_type", "fixed")
      .lt("starts_at", to.toISOString())
      .gt("ends_at", from.toISOString()),
    supabase
      .from("calendula_tasks")
      .select("estimated_minutes, deadline")
      .eq("user_id", userId)
      .eq("status", "active")
      .not("deadline", "is", null),
    supabase
      .from("calendula_activity_holds")
      .select("ends_at, activity_type_id")
      .eq("user_id", userId)
      .eq("status", "held"),
    supabase.from("calendula_activity_types").select("id, buffer_after_hours").eq("user_id", userId),
  ]);
  if (fixedError) throw fixedError;
  if (placementsError) throw placementsError;
  if (tasksError) throw tasksError;
  if (holdsError) throw holdsError;
  if (typesError) throw typesError;

  const bufferHoursByActivityType = new Map((activityTypes ?? []).map((t) => [t.id, t.buffer_after_hours]));

  const hardHoursByDay = new Map<string, number>();
  const recoveryHoursByDay = new Map<string, number>();

  for (const p of hardPlacements ?? []) {
    const start = new Date(p.starts_at);
    const durationHours = (new Date(p.ends_at).getTime() - start.getTime()) / (60 * 60_000);
    for (const [day, hours] of allocateHoursAcrossDays(start, durationHours, timezone)) addTo(hardHoursByDay, day, hours);
  }

  for (const block of fixedBlocks ?? []) {
    const occurrences = expandFixedBlock(
      { id: block.id, startsAt: new Date(block.starts_at), endsAt: new Date(block.ends_at), rrule: block.rrule },
      timezone,
      from,
      to,
    );
    for (const occ of occurrences) {
      const durationHours = (occ.end.getTime() - occ.start.getTime()) / (60 * 60_000);
      for (const [day, hours] of allocateHoursAcrossDays(occ.start, durationHours, timezone)) addTo(hardHoursByDay, day, hours);

      if (block.high_exertion) {
        for (const [day, hours] of allocateHoursAcrossDays(occ.end, DEFAULT_FIXED_BLOCK_RECOVERY_HOURS, timezone)) {
          addTo(recoveryHoursByDay, day, hours);
        }
      }
    }
  }

  for (const hold of activityHolds ?? []) {
    const bufferHours = bufferHoursByActivityType.get(hold.activity_type_id) ?? 0;
    if (bufferHours <= 0) continue;
    for (const [day, hours] of allocateHoursAcrossDays(new Date(hold.ends_at), bufferHours, timezone)) {
      addTo(recoveryHoursByDay, day, hours);
    }
  }

  const deadlinePressureMinutesByDay = new Map<string, number>();
  let cursor = DateTime.fromJSDate(from, { zone: timezone }).startOf("day");
  const end = DateTime.fromJSDate(to, { zone: timezone }).startOf("day");
  const days: DateTime[] = [];
  while (cursor <= end) {
    days.push(cursor);
    cursor = cursor.plus({ days: 1 });
  }

  for (const task of tasks ?? []) {
    if (!task.deadline) continue;
    const deadline = new Date(task.deadline);
    for (const day of days) {
      const weight = deadlineProximityWeight(deadline, day.toJSDate());
      if (weight <= 0) continue;
      addTo(deadlinePressureMinutesByDay, day.toISODate() ?? "", task.estimated_minutes * weight);
    }
  }

  const loadByDay = new Map<string, number>();
  const hardDayFlags = new Map<string, boolean>();
  const deadlinePressureByDay = new Map<string, number>();
  for (const day of days) {
    const key = day.toISODate() ?? "";
    const deadlinePressureMinutes = deadlinePressureMinutesByDay.get(key) ?? 0;
    loadByDay.set(
      key,
      projectedLoadCore({
        hardHours: hardHoursByDay.get(key) ?? 0,
        deadlinePressureMinutes,
        recoveryDebtHours: recoveryHoursByDay.get(key) ?? 0,
      }),
    );
    hardDayFlags.set(key, (hardHoursByDay.get(key) ?? 0) > 0);
    // Same [0,1] normalisation as loadByDay, isolated to just this one
    // component (§8.2's deadlinePenalty wants this signal alone, not the
    // hard-hours/recovery-debt-blended total).
    deadlinePressureByDay.set(key, projectedLoadCore({ hardHours: 0, deadlinePressureMinutes, recoveryDebtHours: 0 }));
  }
  return { loadByDay, hardDayFlags, deadlinePressureByDay };
}

"use server";

import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import { requestSolve } from "@/lib/scheduler/dispatch";
import { solve } from "@/lib/scheduler/solve";
import { findFutureWindows } from "@/lib/scheduler/findFutureWindows";
import { cascadeDismissDerivedReminder } from "@/lib/scheduler/generateDerivedReminders";
import type { ScoredWindow } from "@/lib/scheduler/futureWindows";

export interface CreateActivityTypeResult {
  ok: boolean;
  message: string;
}

/** spec §5.6 — the activity type an activity hold books time against (e.g. "Camping"). */
export async function createActivityType(
  _prev: CreateActivityTypeResult | null,
  formData: FormData,
): Promise<CreateActivityTypeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const name = String(formData.get("name") ?? "").trim();
  const minDurationHours = Number(formData.get("minDurationHours"));
  const requiresOvernight = formData.get("requiresOvernight") === "on";
  const seasonStart = String(formData.get("seasonStart") ?? "").trim() || null;
  const seasonEnd = String(formData.get("seasonEnd") ?? "").trim() || null;
  const leadTimeDays = Number(formData.get("leadTimeDays") ?? 0);
  const bufferAfterHours = Number(formData.get("bufferAfterHours") ?? 0);
  const weatherSensitive = formData.get("weatherSensitive") === "on";

  if (!name) return { ok: false, message: "Name is required." };
  if (!Number.isFinite(minDurationHours) || minDurationHours <= 0) {
    return { ok: false, message: "Minimum duration must be a positive number of hours." };
  }

  const { error } = await supabase.from("calendula_activity_types").insert({
    user_id: user.id,
    name,
    min_duration_hours: minDurationHours,
    requires_overnight: requiresOvernight,
    season_start: seasonStart,
    season_end: seasonEnd,
    lead_time_days: Number.isFinite(leadTimeDays) ? leadTimeDays : 0,
    buffer_after_hours: Number.isFinite(bufferAfterHours) ? bufferAfterHours : 0,
    weather_sensitive: weatherSensitive,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/planning");
  return { ok: true, message: `"${name}" added.` };
}

export interface FindWindowsResult {
  ok: boolean;
  message: string;
  activityTypeId: string | null;
  windows: ScoredWindow[];
}

/** spec §8.2. */
export async function searchFutureWindows(
  _prev: FindWindowsResult | null,
  formData: FormData,
): Promise<FindWindowsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in.", activityTypeId: null, windows: [] };

  const activityTypeId = String(formData.get("activityTypeId") ?? "");
  const horizonDays = Number(formData.get("horizonDays") ?? 90);
  if (!activityTypeId) return { ok: false, message: "Pick an activity type.", activityTypeId: null, windows: [] };

  const windows = await findFutureWindows(user.id, { activityTypeId, horizonDays }, supabase);

  return {
    ok: true,
    activityTypeId,
    windows,
    message:
      windows.length > 0
        ? `${windows.length} option${windows.length === 1 ? "" : "s"} found.`
        : "Nothing open in that range — every candidate window either hits a hard commitment or falls outside the season.",
  };
}

export interface CreateHoldResult {
  ok: boolean;
  message: string;
  holdId?: string;
}

/**
 * spec §8.3. Holds are committed immediately (not previewed-then-committed)
 * and the consequence is reported honestly, with `releaseActivityHold` as
 * the way back out — simpler than building a true dry-run-with-a-
 * hypothetical-extra-hard-placement preview path, and the spec's own
 * acceptance criterion ("the conflict surfaces when the hold makes work
 * unplaceable") is satisfied either way. Baseline unplaceable set is read
 * *before* the hold exists so the comparison is honest about what changed.
 */
export async function createActivityHold(
  activityTypeId: string,
  startDay: string,
  endDay: string,
): Promise<CreateHoldResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const { data: profile } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone")
    .eq("user_id", user.id)
    .single();
  if (!profile) return { ok: false, message: "No scheduling profile — sign in again." };

  const { data: activityType } = await supabase
    .from("calendula_activity_types")
    .select("id, name")
    .eq("id", activityTypeId)
    .eq("user_id", user.id)
    .single();
  if (!activityType) return { ok: false, message: "Activity type not found." };

  const baseline = await solve(user.id, { dryRun: true }, supabase);
  const baselineUnplaceableIds = new Set(baseline.unplaceable.map((u) => u.taskId));

  const starts = DateTime.fromISO(startDay, { zone: profile.timezone }).startOf("day").toJSDate();
  const ends = DateTime.fromISO(endDay, { zone: profile.timezone }).endOf("day").toJSDate();

  const { data: hold, error: holdError } = await supabase
    .from("calendula_activity_holds")
    .insert({
      user_id: user.id,
      activity_type_id: activityTypeId,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      status: "held",
    })
    .select("id")
    .single();
  if (holdError || !hold) return { ok: false, message: holdError?.message ?? "Could not create the hold." };

  const { error: placeError } = await supabase.from("calendula_placements").insert({
    user_id: user.id,
    source_type: "activity_hold",
    source_id: hold.id,
    title: activityType.name,
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    hardness: "hard",
    pinned: false,
  });
  if (placeError) return { ok: false, message: placeError.message };

  const after = await requestSolve(user.id, "activity_hold_created", supabase);
  revalidatePath("/planning");
  revalidatePath("/week");

  const newlyUnplaceable = after.unplaceable.filter((u) => !baselineUnplaceableIds.has(u.taskId));
  if (newlyUnplaceable.length > 0) {
    const { data: newlyUnplaceableTasks } = await supabase
      .from("calendula_tasks")
      .select("id, title")
      .in(
        "id",
        newlyUnplaceable.map((u) => u.taskId),
      );
    const titleById = new Map((newlyUnplaceableTasks ?? []).map((t) => [t.id, t.title]));
    const titles = newlyUnplaceable.map((u) => `"${titleById.get(u.taskId) ?? u.taskId}"`).join(", ");
    return {
      ok: true,
      holdId: hold.id,
      message: `Held ${startDay}–${endDay} for ${activityType.name} — but that pushed ${newlyUnplaceable.length} task(s) out of room: ${titles}. Release it below if that's not worth it.`,
    };
  }

  return {
    ok: true,
    holdId: hold.id,
    message: `Held ${startDay}–${endDay} for ${activityType.name} — everything else still fits.`,
  };
}

export interface ReleaseHoldResult {
  ok: boolean;
  message: string;
}

export async function releaseActivityHold(holdId: string): Promise<ReleaseHoldResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const { error: placementError } = await supabase
    .from("calendula_placements")
    .delete()
    .eq("user_id", user.id)
    .eq("source_type", "activity_hold")
    .eq("source_id", holdId);
  if (placementError) return { ok: false, message: placementError.message };

  const { error: holdError } = await supabase
    .from("calendula_activity_holds")
    .update({ status: "released" })
    .eq("id", holdId)
    .eq("user_id", user.id);
  if (holdError) return { ok: false, message: holdError.message };

  // spec §10.7: "when the parent record is completed, cancelled, or
  // deleted, the derived reminder cascades to dismissed."
  await cascadeDismissDerivedReminder(user.id, "activity_hold", holdId, supabase);

  await requestSolve(user.id, "activity_hold_released", supabase);
  revalidatePath("/planning");
  revalidatePath("/week");
  revalidatePath("/reminders");

  return { ok: true, message: "Released — coursework can move back into that window." };
}

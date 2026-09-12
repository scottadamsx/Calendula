"use server";

import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import { requestSolve } from "@/lib/scheduler/dispatch";
import { syncFixedBlockPlacements, expandFixedBlock } from "@/lib/scheduler/fixedBlocks";
import { describeFixedBlockConflict } from "@/lib/scheduler/fixedBlockConflict";
import { describePlacements } from "@/lib/scheduler/describePlacements";
import type { DeletableKind } from "@/app/actions/deleteItems";

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

export interface UpdatePatch {
  title?: string;
  startsAt?: string;
  endsAt?: string;
  repeatsOnDays?: string[];
  location?: string | null;
  estimatedMinutes?: number;
  deadline?: string | null;
  priority?: number;
  durationMinutes?: number;
  targetSessionsPerWeek?: number;
  minSpacingHours?: number;
  earliestTime?: string | null;
  latestTime?: string | null;
  reminderKind?: "moment" | "window" | "latent";
  dueAt?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  importance?: number;
}

function localDate(raw: string | null | undefined): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * In-place edit for the four item kinds, so "the lecture ends at 8, not
 * 7:30" doesn't have to become delete-and-recreate (which loses the row's
 * identity and history). Same guards as create: a fixed block is re-checked
 * for overlaps (ignoring its own current occurrences), its placements are
 * rebuilt, and anything that affects the grid triggers a real re-solve.
 */
export async function updateCalendarItem(kind: DeletableKind, id: string, patch: UpdatePatch): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const { data: profile } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone, horizon_days, far_horizon_days")
    .eq("user_id", user.id)
    .single();
  if (!profile) return { ok: false, message: "No scheduling profile." };
  const tz = profile.timezone;
  const fmt = (d: Date) => DateTime.fromJSDate(d, { zone: tz }).toFormat("ccc LLL d, h:mma");

  if (kind === "fixed_block") {
    const { data: row } = await supabase.from("calendula_fixed_blocks").select("id, title, starts_at, ends_at, rrule, location").eq("user_id", user.id).eq("id", id).maybeSingle();
    if (!row) return { ok: false, message: "No fixed block with that id. List items again for current ids." };
    const startsAt = localDate(patch.startsAt) === undefined && patch.startsAt !== undefined ? undefined : (localDate(patch.startsAt) ?? new Date(row.starts_at));
    const endsAt = localDate(patch.endsAt) === undefined && patch.endsAt !== undefined ? undefined : (localDate(patch.endsAt) ?? new Date(row.ends_at));
    if (!startsAt || !endsAt) return { ok: false, message: "Start or end isn't a valid local datetime (YYYY-MM-DDTHH:mm)." };
    if (endsAt <= startsAt) return { ok: false, message: "End must be after start." };
    let rrule: string | null = row.rrule;
    if (patch.repeatsOnDays !== undefined) {
      const days = WEEKDAY_CODES.filter((c) => patch.repeatsOnDays!.includes(c));
      rrule = days.length ? `FREQ=WEEKLY;BYDAY=${days.join(",")}` : null;
    }
    const title = patch.title?.trim() || row.title;
    const location = patch.location === undefined ? row.location : patch.location?.trim() || null;

    const conflict = await describeFixedBlockConflict(supabase, user.id, profile, { startsAt, endsAt, rrule }, id);
    if (conflict) return { ok: false, message: conflict };

    const { error } = await supabase
      .from("calendula_fixed_blocks")
      .update({ title, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), rrule, location })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return { ok: false, message: error.message };

    await supabase.from("calendula_placements").delete().eq("user_id", user.id).eq("source_type", "fixed").eq("source_id", id);
    const horizonEnd = new Date(Date.now() + profile.horizon_days * 24 * 60 * 60_000);
    await syncFixedBlockPlacements(user.id, new Date(), horizonEnd);
    await requestSolve(user.id, "fixed_block_updated", supabase);
    revalidatePath("/week");
    const own = expandFixedBlock({ id, startsAt, endsAt, rrule }, tz, new Date(), horizonEnd);
    return {
      ok: true,
      message: `"${title}" updated: ${fmt(startsAt)} to ${DateTime.fromJSDate(endsAt, { zone: tz }).toFormat("h:mma")}${rrule ? `, repeating ${rrule.replace("FREQ=WEEKLY;BYDAY=", "weekly on ")}` : ""}. ${own.length} occurrence${own.length === 1 ? "" : "s"} in the next ${profile.horizon_days} days; the schedule was re-solved around it.`,
    };
  }

  if (kind === "task") {
    const { data: row } = await supabase.from("calendula_tasks").select("id, title, estimated_minutes, remaining_minutes, deadline, priority").eq("user_id", user.id).eq("id", id).maybeSingle();
    if (!row) return { ok: false, message: "No task with that id." };
    const update: Record<string, unknown> = {};
    if (patch.title?.trim()) update.title = patch.title.trim();
    if (patch.estimatedMinutes !== undefined) {
      if (!Number.isFinite(patch.estimatedMinutes) || patch.estimatedMinutes <= 0) return { ok: false, message: "Minutes must be positive." };
      update.estimated_minutes = patch.estimatedMinutes;
      update.remaining_minutes = Math.max(0, row.remaining_minutes + (patch.estimatedMinutes - row.estimated_minutes));
    }
    if (patch.deadline !== undefined) {
      const d = localDate(patch.deadline);
      if (d === undefined) return { ok: false, message: "Deadline isn't a valid local datetime." };
      update.deadline = d ? d.toISOString() : null;
    }
    if (patch.priority !== undefined) update.priority = Math.min(5, Math.max(1, Math.round(patch.priority)));
    if (Object.keys(update).length === 0) return { ok: false, message: "Nothing to change." };
    const { error } = await supabase.from("calendula_tasks").update(update).eq("id", id).eq("user_id", user.id);
    if (error) return { ok: false, message: error.message };
    const result = await requestSolve(user.id, "task_updated", supabase);
    revalidatePath("/week");
    const title = (update.title as string) ?? row.title;
    return { ok: true, message: `"${title}" updated and re-scheduled: ${describePlacements(result.placements, "task", id, tz)}.` };
  }

  if (kind === "habit") {
    const { data: row } = await supabase.from("calendula_habits").select("id, title").eq("user_id", user.id).eq("id", id).maybeSingle();
    if (!row) return { ok: false, message: "No habit with that id." };
    const update: Record<string, unknown> = {};
    if (patch.title?.trim()) update.title = patch.title.trim();
    if (patch.durationMinutes !== undefined) update.duration_minutes = patch.durationMinutes;
    if (patch.targetSessionsPerWeek !== undefined) update.target_sessions_per_week = patch.targetSessionsPerWeek;
    if (patch.minSpacingHours !== undefined) update.min_spacing_hours = patch.minSpacingHours;
    if (patch.earliestTime !== undefined) update.earliest_time = patch.earliestTime || null;
    if (patch.latestTime !== undefined) update.latest_time = patch.latestTime || null;
    if (Object.keys(update).length === 0) return { ok: false, message: "Nothing to change." };
    const { error } = await supabase.from("calendula_habits").update(update).eq("id", id).eq("user_id", user.id);
    if (error) return { ok: false, message: error.message };
    const result = await requestSolve(user.id, "habit_updated", supabase);
    revalidatePath("/week");
    return { ok: true, message: `"${(update.title as string) ?? row.title}" updated. Sessions this week: ${describePlacements(result.placements, "habit", id, tz, 7)}.` };
  }

  if (kind === "reminder") {
    const { data: row } = await supabase.from("calendula_reminders").select("id, title, kind").eq("user_id", user.id).eq("id", id).maybeSingle();
    if (!row) return { ok: false, message: "No reminder with that id." };
    const update: Record<string, unknown> = {};
    if (patch.title?.trim()) update.title = patch.title.trim();
    if (patch.reminderKind) update.kind = patch.reminderKind;
    for (const [key, col] of [["dueAt", "due_at"], ["windowStart", "window_start"], ["windowEnd", "window_end"]] as const) {
      if (patch[key] !== undefined) {
        const d = localDate(patch[key]);
        if (d === undefined) return { ok: false, message: `${key} isn't a valid local datetime.` };
        update[col] = d ? d.toISOString() : null;
      }
    }
    if (patch.importance !== undefined) update.importance = Math.min(5, Math.max(1, Math.round(patch.importance)));
    if (Object.keys(update).length === 0) return { ok: false, message: "Nothing to change." };
    const { error } = await supabase.from("calendula_reminders").update(update).eq("id", id).eq("user_id", user.id);
    if (error) return { ok: false, message: error.message };
    await supabase.from("calendula_reminder_deliveries").delete().eq("user_id", user.id).eq("reminder_id", id).is("delivered_at", null);
    revalidatePath("/reminders");
    return { ok: true, message: `"${(update.title as string) ?? row.title}" updated; it'll be re-assigned a moment to surface on the next pass.` };
  }

  return { ok: false, message: `Unknown kind "${kind}".` };
}

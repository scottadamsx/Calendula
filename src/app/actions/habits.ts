"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requestSolve } from "@/lib/scheduler/dispatch";
import { describePlacements } from "@/lib/scheduler/describePlacements";

export interface CreateHabitResult {
  ok: boolean;
  message: string;
  id?: string;
}

export async function createHabit(
  _prev: CreateHabitResult | null,
  formData: FormData,
): Promise<CreateHabitResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const title = String(formData.get("title") ?? "").trim();
  const durationMinutes = Number(formData.get("durationMinutes"));
  const targetSessionsPerWeek = Number(formData.get("targetSessionsPerWeek"));
  const minSpacingHours = Number(formData.get("minSpacingHours"));
  const earliestTime = String(formData.get("earliestTime") ?? "").trim() || null;
  const latestTime = String(formData.get("latestTime") ?? "").trim() || null;

  if (!title) return { ok: false, message: "Title is required." };
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return { ok: false, message: "Duration must be a positive number of minutes." };
  }
  if (!Number.isFinite(targetSessionsPerWeek) || targetSessionsPerWeek <= 0) {
    return { ok: false, message: "Sessions per week must be a positive number." };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("calendula_habits")
    .insert({
      user_id: user.id,
      title,
      duration_minutes: durationMinutes,
      target_sessions_per_week: targetSessionsPerWeek,
      min_spacing_hours: Number.isFinite(minSpacingHours) ? minSpacingHours : 24,
      earliest_time: earliestTime,
      latest_time: latestTime,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    return { ok: false, message: insertError?.message ?? "Could not create the habit." };
  }

  const result = await requestSolve(user.id, "habit_created");
  revalidatePath("/week");

  const { data: profile } = await supabase.from("calendula_scheduling_profile").select("timezone").eq("user_id", user.id).single();
  const when = describePlacements(result.placements, "habit", inserted.id, profile?.timezone ?? "UTC", 7);

  const shortfall = result.habitShortfall.find((s) => s.habitId === inserted.id && s.missing > 0);
  if (shortfall) {
    return {
      ok: true,
      id: inserted.id,
      message: `"${title}" added. Sessions so far: ${when}. This week couldn't fit ${shortfall.missing} of them.`,
    };
  }

  return { ok: true, id: inserted.id, message: `"${title}" added. Sessions this week: ${when}.` };
}

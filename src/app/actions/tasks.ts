"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requestSolve } from "@/lib/scheduler/dispatch";
import { describePlacements } from "@/lib/scheduler/describePlacements";

export interface CreateTaskResult {
  ok: boolean;
  message: string;
  id?: string;
}

/**
 * The one entry point for adding a task through the browser — Phase 2 built
 * the solver but nothing to feed it. Inserts the row, then triggers a real
 * solve so the task actually gets scheduled before the page is checked.
 */
export async function createTask(
  _prev: CreateTaskResult | null,
  formData: FormData,
): Promise<CreateTaskResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "Not signed in." };
  }

  const title = String(formData.get("title") ?? "").trim();
  const estimatedMinutes = Number(formData.get("estimatedMinutes"));
  const deadlineRaw = String(formData.get("deadline") ?? "");
  const priority = Number(formData.get("priority") ?? 3);

  if (!title) return { ok: false, message: "Title is required." };
  if (!Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) {
    return { ok: false, message: "Duration must be a positive number of minutes." };
  }
  const deadline = deadlineRaw ? new Date(deadlineRaw) : null;
  if (deadlineRaw && Number.isNaN(deadline?.getTime())) {
    return { ok: false, message: "Deadline isn't a valid date/time." };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("calendula_tasks")
    .insert({
      user_id: user.id,
      title,
      estimated_minutes: estimatedMinutes,
      remaining_minutes: estimatedMinutes,
      deadline: deadline?.toISOString() ?? null,
      priority,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    return { ok: false, message: insertError?.message ?? "Could not create the task." };
  }

  const result = await requestSolve(user.id, "task_created");
  revalidatePath("/week");

  const { data: profile } = await supabase.from("calendula_scheduling_profile").select("timezone").eq("user_id", user.id).single();
  const when = describePlacements(result.placements, "task", inserted.id, profile?.timezone ?? "UTC");

  const failed = result.unplaceable.find((u) => u.taskId === inserted.id);
  if (failed) {
    const placedMinutes = estimatedMinutes - failed.remainingMinutes;
    if (placedMinutes > 0) {
      return {
        ok: true,
        id: inserted.id,
        message: `"${title}" added. Scheduled ${placedMinutes} of ${estimatedMinutes} minutes (${when}); the remaining ${failed.remainingMinutes} couldn't fit before the deadline.`,
      };
    }
    return {
      ok: true,
      id: inserted.id,
      message: `"${title}" added, but there wasn't room for any of it before its deadline — it's unplaceable, not overlapping anything.`,
    };
  }

  return { ok: true, id: inserted.id, message: `"${title}" added and scheduled: ${when}.` };
}

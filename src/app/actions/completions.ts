"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requestSolve } from "@/lib/scheduler/dispatch";
import { cascadeDismissDerivedReminder } from "@/lib/scheduler/generateDerivedReminders";

export interface LogCompletionResult {
  ok: boolean;
  message: string;
}

/**
 * spec §12's daily check-in — "for each soft placement that has passed:
 * done or not, and actual minutes. One tap for 'as planned.'" `actualMinutes`
 * is optional: omitted means "as planned" (defaults to the placement's own
 * duration).
 */
export async function logCompletion(
  placementId: string,
  completed: boolean,
  actualMinutes: number | null,
): Promise<LogCompletionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const { data: placement } = await supabase
    .from("calendula_placements")
    .select("id, source_type, source_id, title, starts_at, ends_at")
    .eq("id", placementId)
    .eq("user_id", user.id)
    .single();
  if (!placement) return { ok: false, message: "Placement not found." };
  if (placement.source_type !== "task" && placement.source_type !== "habit") {
    return { ok: false, message: "Only task and habit sessions get a check-in." };
  }

  const plannedMinutes = Math.round(
    (new Date(placement.ends_at).getTime() - new Date(placement.starts_at).getTime()) / 60_000,
  );
  const finalActualMinutes = completed ? (actualMinutes ?? plannedMinutes) : (actualMinutes ?? 0);

  const { error: insertError } = await supabase.from("calendula_completions").insert({
    user_id: user.id,
    task_id: placement.source_type === "task" ? placement.source_id : null,
    habit_id: placement.source_type === "habit" ? placement.source_id : null,
    placement_id: placement.id,
    planned_minutes: plannedMinutes,
    actual_minutes: finalActualMinutes,
    completed,
  });
  if (insertError) return { ok: false, message: insertError.message };

  if (placement.source_type === "task") {
    // remaining_minutes is work not yet done. A completed chunk consumes its
    // planned minutes (actual minutes feed calibration, not the balance); a
    // skipped chunk consumes nothing, so the minutes are still in the pool
    // and the re-solve below simply finds them a new slot. "Skipped
    // placements increment tasks.skip_count" — habits have no such column.
    const { data: task } = await supabase
      .from("calendula_tasks")
      .select("remaining_minutes, skip_count")
      .eq("id", placement.source_id)
      .single();
    if (task) {
      const update = completed
        ? { remaining_minutes: Math.max(0, task.remaining_minutes - plannedMinutes) }
        : { skip_count: task.skip_count + 1 };
      const { error: updateError } = await supabase.from("calendula_tasks").update(update).eq("id", placement.source_id);
      if (updateError) return { ok: false, message: updateError.message };
    }
    await requestSolve(user.id, completed ? "completion_done" : "completion_skipped", supabase);
  }
  if (completed && placement.source_type === "task") {
    // spec §10.7: a task-at-risk derived reminder is about urgency that a
    // completed session has, at minimum, made progress against — cascade
    // it the same as any other resolved parent record.
    await cascadeDismissDerivedReminder(user.id, "task_at_risk", placement.source_id, supabase);
  }

  revalidatePath("/checkin");
  revalidatePath("/week");
  revalidatePath("/reminders");

  return {
    ok: true,
    message: completed ? `"${placement.title}" marked done.` : `"${placement.title}" marked skipped — it's back in the queue.`,
  };
}

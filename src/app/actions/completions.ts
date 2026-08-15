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

  if (!completed && placement.source_type === "task") {
    // "Incomplete tasks return their remaining minutes to
    // tasks.remaining_minutes and trigger a re-solve" — this placement's
    // chunk didn't happen, so it goes back into the pool to be rescheduled.
    // "Skipped placements increment tasks.skip_count" — habits have no such
    // column (spec §5.4), so this only applies to tasks.
    const { data: task } = await supabase
      .from("calendula_tasks")
      .select("remaining_minutes, estimated_minutes, skip_count")
      .eq("id", placement.source_id)
      .single();
    if (task) {
      const restoredMinutes = Math.min(task.estimated_minutes, task.remaining_minutes + plannedMinutes);
      const { error: updateError } = await supabase
        .from("calendula_tasks")
        .update({ remaining_minutes: restoredMinutes, skip_count: task.skip_count + 1 })
        .eq("id", placement.source_id);
      if (updateError) return { ok: false, message: updateError.message };
    }
    await requestSolve(user.id, "completion_skipped", supabase);
  } else if (completed && placement.source_type === "task") {
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

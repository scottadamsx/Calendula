"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requestSolve } from "@/lib/scheduler/dispatch";
import { demotedReminderDueAt } from "@/lib/scheduler/promotionDemotion";

export interface AcceptDemotionResult {
  ok: boolean;
  message: string;
}

/**
 * spec §10.6: "task becomes a reminder" — inserts a moment reminder due
 * tomorrow morning, retires the task (status 'demoted', out of the
 * scheduler's active pool), and re-solves so its old placements clear.
 */
export async function acceptDemotion(taskId: string): Promise<AcceptDemotionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const { data: task } = await supabase
    .from("calendula_tasks")
    .select("id, title, category_id")
    .eq("id", taskId)
    .eq("user_id", user.id)
    .single();
  if (!task) return { ok: false, message: "Task not found." };

  const { data: profile } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone")
    .eq("user_id", user.id)
    .single();
  const timezone = profile?.timezone ?? "America/St_Johns";

  const { error: reminderError } = await supabase.from("calendula_reminders").insert({
    user_id: user.id,
    category_id: task.category_id,
    title: task.title,
    kind: "moment",
    due_at: demotedReminderDueAt(new Date(), timezone).toISOString(),
  });
  if (reminderError) return { ok: false, message: reminderError.message };

  const { error: taskError } = await supabase
    .from("calendula_tasks")
    .update({ status: "demoted", demotion_offered: true, remaining_minutes: 0 })
    .eq("id", taskId);
  if (taskError) return { ok: false, message: taskError.message };

  await requestSolve(user.id, "task_demoted", supabase);
  revalidatePath("/advisor");
  revalidatePath("/week");

  return { ok: true, message: `"${task.title}" is now a reminder instead of a scheduled block.` };
}

export interface DeclineDemotionResult {
  ok: boolean;
  message: string;
}

export async function declineDemotion(taskId: string): Promise<DeclineDemotionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const { error } = await supabase
    .from("calendula_tasks")
    .update({ demotion_offered: true })
    .eq("id", taskId)
    .eq("user_id", user.id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/advisor");
  return { ok: true, message: "Stays a task — won't ask again." };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requestSolve } from "@/lib/scheduler/dispatch";
import { DEFAULT_PROMOTED_TASK_MINUTES } from "@/lib/scheduler/promotionDemotion";

export interface AcceptPromotionResult {
  ok: boolean;
  message: string;
}

/**
 * spec §10.6: "on accept: insert into tasks(...), set reminder.status =
 * 'promoted', requestSolve(...)." `promotion_offered` gets set regardless
 * of outcome — offered once, ever, per reminder.
 */
export async function acceptPromotion(reminderId: string): Promise<AcceptPromotionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const { data: reminder } = await supabase
    .from("calendula_reminders")
    .select("id, title, category_id")
    .eq("id", reminderId)
    .eq("user_id", user.id)
    .single();
  if (!reminder) return { ok: false, message: "Reminder not found." };

  const { error: taskError } = await supabase.from("calendula_tasks").insert({
    user_id: user.id,
    category_id: reminder.category_id,
    title: reminder.title,
    estimated_minutes: DEFAULT_PROMOTED_TASK_MINUTES,
    remaining_minutes: DEFAULT_PROMOTED_TASK_MINUTES,
    priority: 3,
  });
  if (taskError) return { ok: false, message: taskError.message };

  const { error: reminderError } = await supabase
    .from("calendula_reminders")
    .update({ status: "promoted", promotion_offered: true })
    .eq("id", reminderId);
  if (reminderError) return { ok: false, message: reminderError.message };

  await requestSolve(user.id, "reminder_promoted", supabase);
  revalidatePath("/advisor");
  revalidatePath("/week");

  return { ok: true, message: `"${reminder.title}" is now a ${DEFAULT_PROMOTED_TASK_MINUTES}-minute task, scheduled like any other.` };
}

export interface DeclinePromotionResult {
  ok: boolean;
  message: string;
}

/** spec §10.6: "declining is permanent." */
export async function declinePromotion(reminderId: string): Promise<DeclinePromotionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const { error } = await supabase
    .from("calendula_reminders")
    .update({ promotion_offered: true })
    .eq("id", reminderId)
    .eq("user_id", user.id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/advisor");
  return { ok: true, message: "Stays a reminder — won't ask again." };
}

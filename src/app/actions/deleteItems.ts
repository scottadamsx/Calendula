"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requestSolve } from "@/lib/scheduler/dispatch";

export type DeletableKind = "task" | "habit" | "fixed_block" | "reminder";

const TABLE: Record<DeletableKind, string> = {
  task: "calendula_tasks",
  habit: "calendula_habits",
  fixed_block: "calendula_fixed_blocks",
  reminder: "calendula_reminders",
};

const PLACEMENT_SOURCE: Partial<Record<DeletableKind, string>> = {
  task: "task",
  habit: "habit",
  fixed_block: "fixed",
};

/**
 * Hard delete, scoped by RLS to the signed-in user. Placements sourced from
 * the row go first (no FK cascade exists for them), then the row, then a
 * real re-solve — removing a hard commitment frees time the solver should
 * reconsider, the mirror image of createFixedBlock's own post-create solve.
 */
export async function deleteCalendarItem(kind: DeletableKind, id: string): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!(kind in TABLE)) return { ok: false, message: `Unknown kind "${kind}".` };

  const { data: row } = await supabase.from(TABLE[kind]).select("id, title").eq("user_id", user.id).eq("id", id).maybeSingle();
  if (!row) return { ok: false, message: "Nothing with that id — it may already be gone. List items again to get current ids." };

  const source = PLACEMENT_SOURCE[kind];
  if (source) {
    const { error } = await supabase.from("calendula_placements").delete().eq("user_id", user.id).eq("source_type", source).eq("source_id", id);
    if (error) return { ok: false, message: error.message };
  }
  if (kind === "reminder") {
    const { error } = await supabase.from("calendula_reminder_deliveries").delete().eq("user_id", user.id).eq("reminder_id", id);
    if (error) return { ok: false, message: error.message };
  }

  const { error: deleteError } = await supabase.from(TABLE[kind]).delete().eq("user_id", user.id).eq("id", id);
  if (deleteError) return { ok: false, message: deleteError.message };

  if (source) await requestSolve(user.id, `${kind}_deleted`, supabase);
  revalidatePath("/week");
  revalidatePath("/reminders");

  return { ok: true, message: `"${row.title}" deleted${source ? " — the schedule has been re-solved around the freed time" : ""}.` };
}

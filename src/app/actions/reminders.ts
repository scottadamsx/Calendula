"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assignReminders } from "@/lib/scheduler/assignReminders";

export interface CreateReminderResult {
  ok: boolean;
  message: string;
}

/**
 * spec §10.1/§5.8. Supports moment, window, and latent kinds from the UI —
 * `context` (attached to a placement) is fully supported by the DB schema
 * and the assignment engine (assignReminders.ts) but has no creation form
 * yet, since picking "which placement" needs a placement browser this phase
 * doesn't build. Not a spec gap: §16's Phase 4.5 acceptance criteria only
 * exercise moment-kind budget/deadline behavior.
 */
export async function createReminder(
  _prev: CreateReminderResult | null,
  formData: FormData,
): Promise<CreateReminderResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const title = String(formData.get("title") ?? "").trim();
  const kind = String(formData.get("kind") ?? "moment");
  const importance = Number(formData.get("importance") ?? 3);
  const dueAtRaw = String(formData.get("dueAt") ?? "").trim();
  const windowStartRaw = String(formData.get("windowStart") ?? "").trim();
  const windowEndRaw = String(formData.get("windowEnd") ?? "").trim();

  if (!title) return { ok: false, message: "Title is required." };
  if (!["moment", "window", "latent"].includes(kind)) {
    return { ok: false, message: "Unsupported reminder kind." };
  }

  const row: Record<string, unknown> = {
    user_id: user.id,
    title,
    kind,
    importance: Number.isFinite(importance) ? importance : 3,
  };

  if (kind === "moment") {
    if (!dueAtRaw) return { ok: false, message: "Moment reminders need a due time." };
    row.due_at = new Date(dueAtRaw).toISOString();
  } else if (kind === "window") {
    if (!windowStartRaw || !windowEndRaw) {
      return { ok: false, message: "Window reminders need both a start and an end." };
    }
    const start = new Date(windowStartRaw);
    const end = new Date(windowEndRaw);
    if (end <= start) return { ok: false, message: "The window's end has to be after its start." };
    row.window_start = start.toISOString();
    row.window_end = end.toISOString();
  }

  const { data: inserted, error: insertError } = await supabase
    .from("calendula_reminders")
    .insert(row)
    .select("id")
    .single();
  if (insertError || !inserted) return { ok: false, message: insertError?.message ?? "Could not save the reminder." };

  if (kind === "latent") {
    // latent reminders never consume attention budget (§10.1) — nothing to assign.
    revalidatePath("/reminders");
    return { ok: true, message: `"${title}" saved — it'll surface when it's relevant.` };
  }

  await assignReminders(user.id, supabase);
  const { data: delivery } = await supabase
    .from("calendula_reminder_deliveries")
    .select("scheduled_at")
    .eq("reminder_id", inserted.id)
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  revalidatePath("/reminders");

  return {
    ok: true,
    message: delivery
      ? `"${title}" added and scheduled to surface soon.`
      : `"${title}" added — nothing receptive enough to schedule it yet, it'll keep being considered.`,
  };
}

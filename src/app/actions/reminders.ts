"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface CreateReminderResult {
  ok: boolean;
  message: string;
  id?: string;
}

/**
 * spec §10.1/§5.8. Supports moment, window, and latent kinds from the UI —
 * `context` (attached to a placement) is fully supported by the DB schema
 * and the assignment engine (assignReminders.ts) but has no creation form
 * yet, since picking "which placement" needs a placement browser this phase
 * doesn't build. Not a spec gap: §16's Phase 4.5 acceptance criteria only
 * exercise moment-kind budget/deadline behavior.
 *
 * Deliberately does NOT call assignReminders() itself (Phase 4.5 did, until
 * Phase 4.6 found the bug this caused): assignment only runs "on every solve
 * and on a fifteen-minute cron" per spec §10.4, and creating a reminder
 * isn't a solve trigger. Calling it synchronously per-creation meant every
 * reminder was assigned alone, one candidate at a time — which made
 * batching (§10.5) structurally impossible, since two reminders can only
 * share a digest if the *same* assignReminders() call sees both as
 * candidates together. Caught live: two reminders created seconds apart
 * landed on the identical scheduled block but never got a shared batch_id,
 * because each was assigned in its own solo pass before the other existed.
 * Leaving assignment to solve()/the cron means several reminders created in
 * quick succession are genuinely still pending when the next pass runs, so
 * batching gets a real chance to group them.
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

  revalidatePath("/reminders");

  if (kind === "latent") {
    // latent reminders never consume attention budget (§10.1) — nothing to assign.
    return { ok: true, id: inserted.id, message: `"${title}" saved. It'll surface when it's relevant.` };
  }

  return { ok: true, id: inserted.id, message: `"${title}" added. It'll be assigned a moment to surface on the next scheduling pass.` };
}

export type ReminderOutcome = "acknowledged" | "deferred" | "done" | "dismissed";

export interface RecordOutcomeResult {
  ok: boolean;
  message: string;
}

const STATUS_BY_OUTCOME: Record<ReminderOutcome, string> = {
  acknowledged: "acknowledged",
  // No 'deferred' status exists in the reminders schema (spec §5.8's enum is
  // pending/delivered/acknowledged/done/dismissed/promoted) — deferring goes
  // back to 'pending' so the next assignReminders pass reconsiders it, now
  // with a higher defer_count (§10.3: "deferral raises urgency").
  deferred: "pending",
  done: "done",
  dismissed: "dismissed",
};

/**
 * spec §10.8: "every delivery captures an outcome." No push dispatcher
 * exists yet (deferred, see CLAUDE.md), so the Reminders page is the only
 * delivery surface — clicking an outcome button on a still-undelivered
 * scheduled reminder *is* the delivery event, so this sets delivered_at
 * here if it wasn't already, rather than requiring a separate dispatch step
 * that has nothing to dispatch through.
 */
export async function recordReminderOutcome(reminderId: string, outcome: ReminderOutcome): Promise<RecordOutcomeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const { data: reminder } = await supabase
    .from("calendula_reminders")
    .select("id, defer_count")
    .eq("id", reminderId)
    .eq("user_id", user.id)
    .single();
  if (!reminder) return { ok: false, message: "Reminder not found." };

  const { data: delivery } = await supabase
    .from("calendula_reminder_deliveries")
    .select("id, delivered_at")
    .eq("reminder_id", reminderId)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (delivery) {
    const { error: deliveryError } = await supabase
      .from("calendula_reminder_deliveries")
      .update({ outcome, delivered_at: delivery.delivered_at ?? new Date().toISOString() })
      .eq("id", delivery.id);
    if (deliveryError) return { ok: false, message: deliveryError.message };
  }

  const update: Record<string, unknown> = { status: STATUS_BY_OUTCOME[outcome] };
  if (outcome === "deferred") update.defer_count = reminder.defer_count + 1;
  if (outcome === "done") update.completed_at = new Date().toISOString();

  const { error } = await supabase.from("calendula_reminders").update(update).eq("id", reminderId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/reminders");
  return { ok: true, message: "Updated." };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import { buildGrid } from "./buildGrid";
import {
  assignRemindersCore,
  applyBatching,
  type AttentionProfile,
  type ReminderCandidate,
  type ReminderKind,
} from "./reminders";

export interface AssignRemindersResult {
  assignedCount: number;
}

/**
 * DB-touching wrapper for spec §10.4 — fetches the attention profile and
 * pending reminders, builds the 48h grid (§10.4: "full recompute over the
 * next 48 hours"), and writes `calendula_reminder_deliveries` rows for
 * whatever the pure algorithm in reminders.ts assigns.
 *
 * Same optional-client pattern as solve()/requestSolve(): callers with no
 * browser session (the 15-minute cron) must pass a service-role client
 * explicitly rather than silently hitting an unauthenticated cookie client.
 */
export async function assignReminders(userId: string, client?: SupabaseClient): Promise<AssignRemindersResult> {
  const supabase = client ?? (await createClient());

  const { data: schedulingProfile, error: schedulingError } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone")
    .eq("user_id", userId)
    .single();
  if (schedulingError || !schedulingProfile) {
    throw new Error(`No calendula_scheduling_profile for user ${userId}; cannot assign reminders.`);
  }

  // No signup flow creates calendula_attention_profile yet (same pre-existing
  // gap as calendula_scheduling_profile, see CLAUDE.md) — self-heal with the
  // schema's own column defaults (spec §5.1) rather than requiring a manual
  // insert, per "anything a user needs to do manually is bad programming."
  let attentionRow = (
    await supabase
      .from("calendula_attention_profile")
      .select("attention_budget_per_day, min_gap_minutes, quiet_start, quiet_end, batch_by_default, promote_after_defers")
      .eq("user_id", userId)
      .maybeSingle()
  ).data;

  if (!attentionRow) {
    const { data: created, error: createError } = await supabase
      .from("calendula_attention_profile")
      .insert({ user_id: userId })
      .select("attention_budget_per_day, min_gap_minutes, quiet_start, quiet_end, batch_by_default, promote_after_defers")
      .single();
    if (createError) throw createError;
    attentionRow = created;
  }

  const profile: AttentionProfile = {
    attentionBudgetPerDay: attentionRow.attention_budget_per_day,
    minGapMinutes: attentionRow.min_gap_minutes,
    quietStart: attentionRow.quiet_start,
    quietEnd: attentionRow.quiet_end,
    batchByDefault: attentionRow.batch_by_default,
    promoteAfterDefers: attentionRow.promote_after_defers,
  };

  const { data: pendingReminders, error: remindersError } = await supabase
    .from("calendula_reminders")
    .select("id, kind, due_at, window_start, window_end, trigger_placement_id, lead_minutes, importance, defer_count")
    .eq("user_id", userId)
    .eq("status", "pending")
    .neq("kind", "latent");
  if (remindersError) throw remindersError;
  if (!pendingReminders || pendingReminders.length === 0) return { assignedCount: 0 };

  // A reminder with a still-future scheduled (undelivered) delivery is
  // skipped — extends "rescheduling an already-*delivered* reminder is
  // forbidden" (§10.4) to already-*scheduled* ones too, so the 15-minute
  // cron doesn't pile up duplicate delivery rows for the same reminder
  // every pass.
  const { data: existingDeliveries, error: deliveriesError } = await supabase
    .from("calendula_reminder_deliveries")
    .select("reminder_id, scheduled_at, delivered_at")
    .in(
      "reminder_id",
      pendingReminders.map((r) => r.id),
    );
  if (deliveriesError) throw deliveriesError;

  const now = new Date();
  const alreadyScheduled = new Set(
    (existingDeliveries ?? [])
      .filter((d) => !d.delivered_at && new Date(d.scheduled_at) >= now)
      .map((d) => d.reminder_id),
  );

  const triggerIds = [
    ...new Set(pendingReminders.filter((r) => r.trigger_placement_id).map((r) => r.trigger_placement_id as string)),
  ];
  const triggerStartById = new Map<string, Date>();
  if (triggerIds.length > 0) {
    const { data: triggerPlacements } = await supabase
      .from("calendula_placements")
      .select("id, starts_at")
      .in("id", triggerIds);
    for (const p of triggerPlacements ?? []) triggerStartById.set(p.id, new Date(p.starts_at));
  }

  const candidates: ReminderCandidate[] = pendingReminders
    .filter((r) => !alreadyScheduled.has(r.id))
    .map((r) => ({
      id: r.id,
      kind: r.kind as ReminderKind,
      dueAt: r.due_at ? new Date(r.due_at) : null,
      windowStart: r.window_start ? new Date(r.window_start) : null,
      windowEnd: r.window_end ? new Date(r.window_end) : null,
      triggerPlacementStart: r.trigger_placement_id ? (triggerStartById.get(r.trigger_placement_id) ?? null) : null,
      leadMinutes: r.lead_minutes,
      importance: r.importance,
      deferCount: r.defer_count,
    }));
  if (candidates.length === 0) return { assignedCount: 0 };

  const horizonEnd = new Date(now.getTime() + 48 * 60 * 60_000);
  const blocks = await buildGrid(userId, now, horizonEnd, supabase);

  const startOfDay = DateTime.fromJSDate(now, { zone: schedulingProfile.timezone }).startOf("day").toJSDate();
  const { data: deliveredToday, error: deliveredTodayError } = await supabase
    .from("calendula_reminder_deliveries")
    .select("delivered_at, batch_id, id")
    .eq("user_id", userId)
    .not("delivered_at", "is", null)
    .gte("delivered_at", startOfDay.toISOString());
  if (deliveredTodayError) throw deliveredTodayError;

  // spec §10.5: "batching buys back budget" — a batch of N reminders
  // delivered together costs one real interruption, not N, so today's count
  // toward the budget is the number of distinct batches (falling back to the
  // delivery's own id for anything that wasn't batched), not raw row count.
  const deliveredCountToday = new Set((deliveredToday ?? []).map((d) => d.batch_id ?? d.id)).size;
  const lastDeliveredAtMs = Math.max(
    0,
    ...(deliveredToday ?? []).map((d) => new Date(d.delivered_at as string).getTime()),
  );
  const minutesSinceLastDelivery = lastDeliveredAtMs > 0 ? (now.getTime() - lastDeliveredAtMs) / 60_000 : null;

  const assignments = assignRemindersCore(candidates, blocks, profile, now, {
    timezone: schedulingProfile.timezone,
    deliveredCountToday,
    minutesSinceLastDelivery,
  });
  if (assignments.length === 0) return { assignedCount: 0 };

  const batched = applyBatching(assignments, blocks, profile.batchByDefault);

  // channel: 'inline' — push doesn't exist yet (deliberately deferred, see
  // CLAUDE.md), so the only delivery surface right now is the Reminders
  // page. brief (the daily digest) is also unbuilt (Phase 6). The
  // budget/receptivity/urgency math above still runs in full either way —
  // that's the actual Phase 4.5 deliverable; channel routing is a separate,
  // later concern (§10.8).
  const { error: insertError } = await supabase.from("calendula_reminder_deliveries").insert(
    batched.map((a) => ({
      user_id: userId,
      reminder_id: a.reminderId,
      batch_id: a.batchId,
      scheduled_at: a.blockStart.toISOString(),
      channel: "inline",
      receptivity: a.receptivity,
      urgency: a.urgency,
    })),
  );
  if (insertError) throw insertError;

  return { assignedCount: batched.length };
}

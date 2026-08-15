import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { solve } from "./solve";
import {
  formatActivityHoldReminderTitle,
  formatMeetingFollowUpTitle,
  formatHabitShortfallReminderTitle,
  formatTaskAtRiskReminderTitle,
  formatCadenceReminderTitle,
  nextFridayMorning,
} from "./derivedReminders";

export interface GenerateDerivedRemindersResult {
  created: number;
}

/**
 * DB wrapper for spec §10.7 — the second of the three named crons (§13:
 * "derived-reminder generation nightly"). Five of the spec's six sources
 * are implemented; "Task with a person_id" is not — `tasks` (spec §5.4)
 * has no `person_id` column at all, only `reminders` does. Unlike the
 * other resolved-in-place gaps in this project, there's no reasonable
 * default to fall back to when the underlying data simply doesn't exist;
 * flagged here rather than silently invented.
 */
export async function generateDerivedReminders(userId: string, client?: SupabaseClient): Promise<GenerateDerivedRemindersResult> {
  const supabase = client ?? (await createClient());

  const { data: profile, error: profileError } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone")
    .eq("user_id", userId)
    .single();
  if (profileError || !profile) {
    throw new Error(`No calendula_scheduling_profile for user ${userId}; cannot generate derived reminders.`);
  }

  const now = new Date();

  const { data: existingDerived, error: existingError } = await supabase
    .from("calendula_reminders")
    .select("derived_from_type, derived_from_id")
    .eq("user_id", userId)
    .eq("source", "derived");
  if (existingError) throw existingError;
  // spec §10.7: "idempotent on that pair" — a derived reminder already
  // exists for this (type, id), regardless of its current status.
  const existingKeys = new Set((existingDerived ?? []).map((r) => `${r.derived_from_type}:${r.derived_from_id}`));

  type DerivedRow = {
    user_id: string;
    title: string;
    kind: "moment" | "window";
    due_at?: string;
    window_start?: string;
    window_end?: string;
    cost?: "ambient" | "notify" | "insist";
    source: "derived";
    derived_from_type: string;
    derived_from_id: string;
  };
  const rows: DerivedRow[] = [];

  // 1. activity_holds -> "Book <activity type>" at starts_at - lead_time_days.
  const { data: holds, error: holdsError } = await supabase
    .from("calendula_activity_holds")
    .select("id, starts_at, activity_type_id")
    .eq("user_id", userId)
    .eq("status", "held");
  if (holdsError) throw holdsError;
  if (holds && holds.length > 0) {
    const typeIds = [...new Set(holds.map((h) => h.activity_type_id))];
    const { data: types } = await supabase.from("calendula_activity_types").select("id, name, lead_time_days").in("id", typeIds);
    const typeById = new Map((types ?? []).map((t) => [t.id, t]));
    for (const hold of holds) {
      const key = `activity_hold:${hold.id}`;
      if (existingKeys.has(key)) continue;
      const type = typeById.get(hold.activity_type_id);
      if (!type) continue;
      const dueAt = new Date(new Date(hold.starts_at).getTime() - type.lead_time_days * 24 * 60 * 60_000);
      rows.push({
        user_id: userId,
        title: formatActivityHoldReminderTitle(type.name),
        kind: "moment",
        due_at: dueAt.toISOString(),
        source: "derived",
        derived_from_type: "activity_hold",
        derived_from_id: hold.id,
      });
    }
  }

  // 2. meeting_offers -> "<person> hasn't replied" at expires_at - 12h.
  const { data: offers, error: offersError } = await supabase
    .from("calendula_meeting_offers")
    .select("id, person_ids, meeting_type, expires_at")
    .eq("user_id", userId)
    .eq("status", "open");
  if (offersError) throw offersError;
  if (offers && offers.length > 0) {
    const allPersonIds = [...new Set(offers.flatMap((o) => o.person_ids ?? []))];
    const { data: people } = allPersonIds.length > 0 ? await supabase.from("calendula_people").select("id, name").in("id", allPersonIds) : { data: [] };
    const nameById = new Map<string, string>((people ?? []).map((p) => [p.id, p.name]));
    for (const offer of offers) {
      const key = `meeting_offer:${offer.id}`;
      if (existingKeys.has(key)) continue;
      const dueAt = new Date(new Date(offer.expires_at).getTime() - 12 * 60 * 60_000);
      if (dueAt <= now) continue; // already past the useful window — nothing to nudge about
      const names = (offer.person_ids ?? [])
        .map((id: string) => nameById.get(id))
        .filter((n: string | undefined): n is string => Boolean(n));
      rows.push({
        user_id: userId,
        title: formatMeetingFollowUpTitle(names, offer.meeting_type),
        kind: "moment",
        due_at: dueAt.toISOString(),
        source: "derived",
        derived_from_type: "meeting_offer",
        derived_from_id: offer.id,
      });
    }
  }

  // 3 & 4 read off the same dry-run solve — habit shortfall and at-risk tasks.
  const dryRun = await solve(userId, { dryRun: true }, supabase);

  const shortfalls = dryRun.habitShortfall.filter((s) => s.missing > 0);
  if (shortfalls.length > 0) {
    const habitIds = shortfalls.map((s) => s.habitId);
    const { data: habits } = await supabase.from("calendula_habits").select("id, title").in("id", habitIds);
    const titleByHabitId = new Map((habits ?? []).map((h) => [h.id, h.title]));
    const fridayMorning = nextFridayMorning(now, profile.timezone);
    for (const s of shortfalls) {
      const key = `habit_shortfall:${s.habitId}`;
      if (existingKeys.has(key)) continue;
      const title = titleByHabitId.get(s.habitId);
      if (!title) continue;
      rows.push({
        user_id: userId,
        title: formatHabitShortfallReminderTitle(title, s.missing),
        kind: "moment",
        due_at: fridayMorning.toISOString(),
        source: "derived",
        derived_from_type: "habit_shortfall",
        derived_from_id: s.habitId,
      });
    }
  }

  if (dryRun.atRisk.length > 0) {
    const taskIds = dryRun.atRisk.map((a) => a.taskId);
    const { data: tasks } = await supabase.from("calendula_tasks").select("id, title").in("id", taskIds);
    const titleByTaskId = new Map((tasks ?? []).map((t) => [t.id, t.title]));
    for (const a of dryRun.atRisk) {
      const key = `task_at_risk:${a.taskId}`;
      if (existingKeys.has(key)) continue;
      const title = titleByTaskId.get(a.taskId);
      if (!title) continue;
      rows.push({
        user_id: userId,
        title: formatTaskAtRiskReminderTitle(title),
        kind: "window",
        window_start: now.toISOString(),
        window_end: new Date(now.getTime() + 4 * 60 * 60_000).toISOString(),
        source: "derived",
        derived_from_type: "task_at_risk",
        derived_from_id: a.taskId,
      });
    }
  }

  // 5. people past cadence -> ambient-cost cadence nudge.
  const { data: people, error: peopleError } = await supabase
    .from("calendula_people")
    .select("id, name, desired_cadence_days, last_interaction_at")
    .eq("user_id", userId)
    .not("desired_cadence_days", "is", null);
  if (peopleError) throw peopleError;
  for (const p of people ?? []) {
    const daysSince = p.last_interaction_at
      ? (now.getTime() - new Date(p.last_interaction_at).getTime()) / (24 * 60 * 60_000)
      : p.desired_cadence_days;
    if (daysSince < p.desired_cadence_days) continue;
    const key = `person_cadence:${p.id}`;
    if (existingKeys.has(key)) continue;
    rows.push({
      user_id: userId,
      title: formatCadenceReminderTitle(p.name, Math.floor(daysSince)),
      kind: "moment",
      due_at: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
      cost: "ambient",
      source: "derived",
      derived_from_type: "person_cadence",
      derived_from_id: p.id,
    });
  }

  if (rows.length === 0) return { created: 0 };

  const { error: insertError } = await supabase.from("calendula_reminders").insert(rows);
  if (insertError) throw insertError;

  return { created: rows.length };
}

/**
 * spec §10.7: "when the parent record is completed, cancelled, or deleted,
 * the derived reminder cascades to dismissed." Shared across every action
 * that resolves a parent record (activity holds, meeting offers,
 * completions, interactions) rather than duplicated per call site.
 */
export async function cascadeDismissDerivedReminder(
  userId: string,
  derivedFromType: string,
  derivedFromId: string,
  client: SupabaseClient,
): Promise<void> {
  await client
    .from("calendula_reminders")
    .update({ status: "dismissed" })
    .eq("user_id", userId)
    .eq("source", "derived")
    .eq("derived_from_type", derivedFromType)
    .eq("derived_from_id", derivedFromId)
    .neq("status", "dismissed");
}

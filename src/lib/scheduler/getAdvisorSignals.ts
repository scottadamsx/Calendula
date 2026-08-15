import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { solve } from "./solve";
import { buildGrid } from "./buildGrid";
import {
  rankOverloadTasks,
  isEstimateDrifted,
  type OverloadCandidate,
  type RelationshipDrift,
} from "./advisorSignals";
import { isPromotionCandidate, isDemotionCandidate, type PromotionCandidate, type DemotionCandidate } from "./promotionDemotion";

export interface AdvisorSignals {
  overload: OverloadCandidate[];
  atRisk: { taskId: string; title: string; slackMinutes: number }[];
  habitShortfall: { habitId: string; title: string; missing: number }[];
  relationshipDrift: RelationshipDrift[];
  estimateDrift: { categoryId: string; categoryName: string; multiplier: number }[];
  promotionCandidates: PromotionCandidate[];
  demotionCandidates: DemotionCandidate[];
  overdueUnassigned: { reminderId: string; title: string; dueAt: Date }[];
}

/** spec §11 — the deterministic signals the advisor layer explains in prose. */
export async function getAdvisorSignals(userId: string, client?: SupabaseClient): Promise<AdvisorSignals> {
  const supabase = client ?? (await createClient());

  const { data: profile, error: profileError } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone")
    .eq("user_id", userId)
    .single();
  if (profileError || !profile) {
    throw new Error(`No calendula_scheduling_profile for user ${userId}; cannot compute advisor signals.`);
  }

  const dryRun = await solve(userId, { dryRun: true }, supabase);

  const overloadTaskIds = dryRun.unplaceable.map((u) => u.taskId);
  const atRiskTaskIds = dryRun.atRisk.map((a) => a.taskId);
  const habitShortfallIds = dryRun.habitShortfall.map((h) => h.habitId);

  const [{ data: overloadTasks }, { data: atRiskTasks }, { data: shortfallHabits }] = await Promise.all([
    overloadTaskIds.length > 0
      ? supabase.from("calendula_tasks").select("id, title, priority").in("id", overloadTaskIds)
      : Promise.resolve({ data: [] }),
    atRiskTaskIds.length > 0
      ? supabase.from("calendula_tasks").select("id, title").in("id", atRiskTaskIds)
      : Promise.resolve({ data: [] }),
    habitShortfallIds.length > 0
      ? supabase.from("calendula_habits").select("id, title").in("id", habitShortfallIds)
      : Promise.resolve({ data: [] }),
  ]);

  const titleByOverloadTaskId = new Map((overloadTasks ?? []).map((t) => [t.id, t.title]));
  const priorityByOverloadTaskId = new Map((overloadTasks ?? []).map((t) => [t.id, t.priority]));
  const overload = rankOverloadTasks(
    dryRun.unplaceable
      .filter((u) => titleByOverloadTaskId.has(u.taskId))
      .map((u) => ({
        taskId: u.taskId,
        title: titleByOverloadTaskId.get(u.taskId) ?? "",
        priority: priorityByOverloadTaskId.get(u.taskId) ?? 3,
        slackMinutes: 0,
      })),
  );

  const titleByAtRiskTaskId = new Map((atRiskTasks ?? []).map((t) => [t.id, t.title]));
  const atRisk = dryRun.atRisk
    .filter((a) => titleByAtRiskTaskId.has(a.taskId))
    .map((a) => ({ taskId: a.taskId, title: titleByAtRiskTaskId.get(a.taskId) ?? "", slackMinutes: a.slackMinutes }));

  const titleByHabitId = new Map((shortfallHabits ?? []).map((h) => [h.id, h.title]));
  const habitShortfall = dryRun.habitShortfall
    .filter((h) => titleByHabitId.has(h.habitId))
    .map((h) => ({ habitId: h.habitId, title: titleByHabitId.get(h.habitId) ?? "", missing: h.missing }));

  // Relationship drift (§11's SQL, expressed via the JS client) + a free
  // social-labelled block in the next 7 days as the "costed free slot."
  const { data: people, error: peopleError } = await supabase
    .from("calendula_people")
    .select("id, name, desired_cadence_days, last_interaction_at")
    .eq("user_id", userId)
    .not("desired_cadence_days", "is", null);
  if (peopleError) throw peopleError;

  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  const drifted = (people ?? []).filter((p) => {
    if (!p.last_interaction_at) return true;
    const daysSince = (now.getTime() - new Date(p.last_interaction_at).getTime()) / (24 * 60 * 60_000);
    return daysSince >= p.desired_cadence_days;
  });

  let relationshipDrift: RelationshipDrift[] = [];
  if (drifted.length > 0) {
    const blocks = await buildGrid(userId, now, weekOut, supabase);
    const freeSocialBlock = blocks.find((b) => b.state === "free" && b.labels.includes("social"));
    relationshipDrift = drifted.map((p) => ({
      personName: p.name,
      daysSince: p.last_interaction_at
        ? Math.floor((now.getTime() - new Date(p.last_interaction_at).getTime()) / (24 * 60 * 60_000))
        : p.desired_cadence_days,
      desiredCadenceDays: p.desired_cadence_days,
      freeSlot: freeSocialBlock ? { start: freeSocialBlock.start, end: freeSocialBlock.end } : null,
    }));
  }

  // Estimate drift.
  const { data: calibrationRows, error: calibrationError } = await supabase
    .from("calendula_duration_calibration")
    .select("category_id, multiplier")
    .eq("user_id", userId)
    .gte("sample_size", 5);
  if (calibrationError) throw calibrationError;
  const driftedCategories = (calibrationRows ?? []).filter((c) => isEstimateDrifted(c.multiplier));
  let estimateDrift: AdvisorSignals["estimateDrift"] = [];
  if (driftedCategories.length > 0) {
    const { data: categories } = await supabase
      .from("calendula_categories")
      .select("id, name")
      .in(
        "id",
        driftedCategories.map((c) => c.category_id),
      );
    const nameByCategoryId = new Map((categories ?? []).map((c) => [c.id, c.name]));
    estimateDrift = driftedCategories.map((c) => ({
      categoryId: c.category_id,
      categoryName: nameByCategoryId.get(c.category_id) ?? "that category",
      multiplier: c.multiplier,
    }));
  }

  // Promotion candidates (spec §10.6): defer_count over threshold, OR
  // pending/non-latent for more than 7 days — not offered before.
  const { data: attentionProfile } = await supabase
    .from("calendula_attention_profile")
    .select("promote_after_defers")
    .eq("user_id", userId)
    .maybeSingle();
  const promoteAfterDefers = attentionProfile?.promote_after_defers ?? 3;

  const { data: promotionRows, error: promotionError } = await supabase
    .from("calendula_reminders")
    .select("id, title, kind, status, defer_count, promotion_offered, created_at")
    .eq("user_id", userId)
    .eq("status", "pending")
    .eq("promotion_offered", false);
  if (promotionError) throw promotionError;
  const promotionCandidates: PromotionCandidate[] = (promotionRows ?? [])
    .filter((r) =>
      isPromotionCandidate(
        { status: r.status, kind: r.kind, deferCount: r.defer_count, createdAt: new Date(r.created_at), promotionOffered: r.promotion_offered },
        now,
        promoteAfterDefers,
      ),
    )
    .map((r) => ({ reminderId: r.id, title: r.title, deferCount: r.defer_count, createdAt: new Date(r.created_at) }));

  // Demotion candidates (spec §10.6): placed and skipped 3+ times, small
  // enough that it was never block-shaped work.
  const { data: demotionRows, error: demotionError } = await supabase
    .from("calendula_tasks")
    .select("id, title, status, skip_count, estimated_minutes, demotion_offered")
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("demotion_offered", false)
    .gte("skip_count", 3);
  if (demotionError) throw demotionError;
  const demotionCandidates: DemotionCandidate[] = (demotionRows ?? [])
    .filter((t) =>
      isDemotionCandidate({ status: t.status, skipCount: t.skip_count, estimatedMinutes: t.estimated_minutes, demotionOffered: t.demotion_offered }),
    )
    .map((t) => ({ taskId: t.id, title: t.title, skipCount: t.skip_count, estimatedMinutes: t.estimated_minutes }));

  // Overdue, never delivered — assignReminders() never schedules past
  // due_at ("never deliver late," Phase 4.5), so these fell through
  // entirely rather than just being late.
  const { data: overdueRows, error: overdueError } = await supabase
    .from("calendula_reminders")
    .select("id, title, due_at")
    .eq("user_id", userId)
    .eq("status", "pending")
    .neq("kind", "latent")
    .not("due_at", "is", null)
    .lt("due_at", now.toISOString());
  if (overdueError) throw overdueError;
  const overdueUnassigned = (overdueRows ?? []).map((r) => ({
    reminderId: r.id,
    title: r.title,
    dueAt: new Date(r.due_at as string),
  }));

  return {
    overload,
    atRisk,
    habitShortfall,
    relationshipDrift,
    estimateDrift,
    promotionCandidates,
    demotionCandidates,
    overdueUnassigned,
  };
}

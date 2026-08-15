import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { computeMultiplier, type CompletionSample } from "./calibration";

export interface RunCalibrationResult {
  categoriesUpdated: number;
}

/**
 * DB wrapper for spec §12's nightly calibration job. Recomputes from every
 * historical completion each run (D2's full-recompute philosophy, already
 * established for solve()), not incrementally.
 *
 * Habit completions are logged (spec §12's check-in covers both sources)
 * but don't feed calibration — `habits` has no `category_id` column at all
 * (spec §5.4), so there's nothing to group a habit completion's ratio
 * under. Only `tasks` carries a category.
 */
export async function runCalibration(userId: string, client?: SupabaseClient): Promise<RunCalibrationResult> {
  const supabase = client ?? (await createClient());

  const { data: completions, error: completionsError } = await supabase
    .from("calendula_completions")
    .select("task_id, planned_minutes, actual_minutes")
    .eq("user_id", userId)
    .not("task_id", "is", null)
    .not("actual_minutes", "is", null);
  if (completionsError) throw completionsError;
  if (!completions || completions.length === 0) return { categoriesUpdated: 0 };

  const taskIds = [...new Set(completions.map((c) => c.task_id as string))];
  const { data: tasks, error: tasksError } = await supabase.from("calendula_tasks").select("id, category_id").in("id", taskIds);
  if (tasksError) throw tasksError;
  const categoryByTaskId = new Map((tasks ?? []).filter((t) => t.category_id).map((t) => [t.id, t.category_id as string]));

  const samplesByCategory = new Map<string, CompletionSample[]>();
  for (const c of completions) {
    const categoryId = categoryByTaskId.get(c.task_id as string);
    if (!categoryId || c.planned_minutes === null || c.actual_minutes === null) continue;
    const list = samplesByCategory.get(categoryId) ?? [];
    list.push({ actualMinutes: c.actual_minutes, plannedMinutes: c.planned_minutes });
    samplesByCategory.set(categoryId, list);
  }

  let categoriesUpdated = 0;
  for (const [categoryId, samples] of samplesByCategory) {
    const multiplier = computeMultiplier(samples);
    if (multiplier === null) continue;
    const { error: upsertError } = await supabase.from("calendula_duration_calibration").upsert(
      {
        user_id: userId,
        category_id: categoryId,
        multiplier,
        sample_size: samples.length,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,category_id" },
    );
    if (upsertError) throw upsertError;
    categoriesUpdated++;
  }

  return { categoriesUpdated };
}

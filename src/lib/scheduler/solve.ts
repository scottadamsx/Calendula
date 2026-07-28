import { createClient } from "@/lib/supabase/server";
import { computeGrid, type Block } from "./grid";
import { solveCore, type TaskInput } from "./solveCore";
import type { EnergyLabel, SolveOptions, SolveResult } from "./types";

/**
 * Pure function: inputs in, result out, no module-level state (spec §4, §7.1).
 * `userId` is always explicit — nothing reads "current user" implicitly.
 *
 * DB access lives here rather than in solveCore.ts (the actual least-slack-
 * time algorithm, spec §7.2/§7.3) so the algorithm itself stays testable
 * without a database — same split as buildGrid.ts / grid.ts.
 *
 * Phase 3+ fields this doesn't populate yet: `habitShortfall` (habits pass
 * doesn't exist until Phase 3) and `derivedReminders` (Phase 6.5) are always
 * empty — honest about what's actually implemented, not a placeholder lie.
 */
export async function solve(userId: string, opts?: SolveOptions): Promise<SolveResult> {
  const supabase = await createClient();
  const dryRun = opts?.dryRun ?? false;

  const { data: profile, error: profileError } = await supabase
    .from("calendula_scheduling_profile")
    .select(
      "timezone, sleep_start, sleep_end, block_minutes, freeze_window_hours, horizon_days, max_task_minutes_per_day, movement_penalty, min_break_minutes",
    )
    .eq("user_id", userId)
    .single();

  if (profileError || !profile) {
    throw new Error(`No calendula_scheduling_profile for user ${userId}; cannot solve.`);
  }

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + profile.horizon_days * 24 * 60 * 60_000);
  const freezeUntil = new Date(now.getTime() + profile.freeze_window_hours * 60 * 60_000);

  // D2/D7: every solve recomputes the full horizon from scratch, except
  // anything inside the freeze window, which never moves without
  // confirmation. dryRun never writes — it simulates against what's there.
  // Scoped to source_type='task' — Phase 2 only implements the task solver;
  // the habit pass (§7.4, D2's "recompute everything soft" in full) is
  // Phase 3, so there's nothing here yet to safely delete-and-regenerate
  // for habit-sourced placements.
  if (!dryRun) {
    const { error: deleteError } = await supabase
      .from("calendula_placements")
      .delete()
      .eq("user_id", userId)
      .eq("source_type", "task")
      .eq("hardness", "soft")
      .gte("starts_at", freezeUntil.toISOString());
    if (deleteError) throw deleteError;
  }

  const { data: existingPlacements, error: placementsError } = await supabase
    .from("calendula_placements")
    .select("source_id, source_type, title, starts_at, ends_at, hardness, pinned, location")
    .eq("user_id", userId)
    .lt("starts_at", horizonEnd.toISOString())
    .gt("ends_at", now.toISOString());
  if (placementsError) throw placementsError;

  // dryRun never deleted anything above, so task-sourced soft placements
  // outside the freeze window are still present here and must be excluded
  // from the grid by hand — otherwise the solver would see its own old
  // placements as pre-occupied and never get a chance to re-place them.
  const gridPlacements = dryRun
    ? (existingPlacements ?? []).filter(
        (p) => !(p.source_type === "task" && p.hardness === "soft" && new Date(p.starts_at) >= freezeUntil),
      )
    : existingPlacements ?? [];

  const previousTaskPlacements = (existingPlacements ?? []).filter(
    (p) => p.source_type === "task" && p.hardness === "soft",
  );

  const { data: energyWindows, error: energyError } = await supabase
    .from("calendula_energy_windows")
    .select("day_of_week, start_time, end_time, quality, label")
    .eq("user_id", userId);
  if (energyError) throw energyError;

  const { data: tasks, error: tasksError } = await supabase
    .from("calendula_tasks")
    .select(
      "id, category_id, title, remaining_minutes, deadline, priority, min_chunk_minutes, max_chunk_minutes, splittable, preferred_labels, status",
    )
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("remaining_minutes", 0);
  if (tasksError) throw tasksError;

  const { data: calibrationRows, error: calibrationError } = await supabase
    .from("calendula_duration_calibration")
    .select("category_id, multiplier")
    .eq("user_id", userId);
  if (calibrationError) throw calibrationError;

  const blocks: Block[] = computeGrid({
    from: now,
    to: horizonEnd,
    now,
    timezone: profile.timezone,
    blockMinutes: profile.block_minutes,
    sleepStart: profile.sleep_start,
    sleepEnd: profile.sleep_end,
    freezeWindowHours: profile.freeze_window_hours,
    placements: gridPlacements.map((p) => ({
      sourceId: p.source_id,
      title: p.title,
      startsAt: new Date(p.starts_at),
      endsAt: new Date(p.ends_at),
      hardness: p.hardness as "hard" | "soft" | "tentative",
      pinned: p.pinned,
      location: p.location,
      travelBufferMinutes: 0,
    })),
    energyWindows: (energyWindows ?? []).map((w) => ({
      dayOfWeek: w.day_of_week,
      startTime: w.start_time,
      endTime: w.end_time,
      quality: w.quality,
      label: w.label as EnergyLabel,
    })),
  });

  for (const range of opts?.excludeRanges ?? []) {
    for (const block of blocks) {
      if (block.start < range.end && block.end > range.start && block.state === "free") {
        block.state = "unavailable";
      }
    }
  }

  const previousByTaskId = new Map<string, { start: Date; end: Date }>();
  for (const p of previousTaskPlacements) {
    // A task previously split across multiple sessions only keeps its
    // first-seen chunk here — the movement penalty compares against that
    // one, not every prior session. Acceptable for Phase 2: none of the
    // spec's §16 acceptance criteria depend on multi-chunk movement history.
    if (!previousByTaskId.has(p.source_id)) {
      previousByTaskId.set(p.source_id, { start: new Date(p.starts_at), end: new Date(p.ends_at) });
    }
  }

  const calibrationByCategory = new Map<string, number>();
  for (const row of calibrationRows ?? []) {
    calibrationByCategory.set(row.category_id, row.multiplier);
  }

  const taskInputs: TaskInput[] = (tasks ?? []).map((t) => ({
    id: t.id,
    categoryId: t.category_id,
    title: t.title,
    remainingMinutes: t.remaining_minutes,
    deadline: t.deadline ? new Date(t.deadline) : null,
    priority: t.priority,
    minChunkMinutes: t.min_chunk_minutes,
    maxChunkMinutes: t.max_chunk_minutes,
    splittable: t.splittable,
    preferredLabels: (t.preferred_labels ?? []) as EnergyLabel[],
  }));

  const result = solveCore({
    now,
    timezone: profile.timezone,
    blocks,
    tasks: taskInputs,
    previousByTaskId,
    calibrationByCategory,
    maxTaskMinutesPerDay: profile.max_task_minutes_per_day,
    minBreakMinutes: profile.min_break_minutes,
    movementPenalty: profile.movement_penalty,
  });

  if (!dryRun && result.placements.length > 0) {
    const rows = result.placements.map((p) => {
      const task = taskInputs.find((t) => t.id === p.taskId)!;
      return {
        user_id: userId,
        source_type: "task" as const,
        source_id: p.taskId,
        title: task.title,
        starts_at: p.start.toISOString(),
        ends_at: p.end.toISOString(),
        hardness: "soft" as const,
        pinned: false,
      };
    });
    const { error: insertError } = await supabase.from("calendula_placements").insert(rows);
    if (insertError) throw insertError;
  }

  if (!dryRun) {
    const { error: auditError } = await supabase.from("calendula_schedule_runs").insert({
      user_id: userId,
      trigger: opts?.trigger ?? "manual",
      horizon_start: now.toISOString(),
      horizon_end: horizonEnd.toISOString(),
      unplaceable: result.unplaceable.map((u) => ({
        taskId: u.taskId,
        remainingMinutes: u.remainingMinutes,
        deadline: u.deadline?.toISOString() ?? null,
      })),
      moved_count: result.movedCount,
    });
    if (auditError) throw auditError;
  }

  return {
    placements: result.placements.map((p) => {
      const task = taskInputs.find((t) => t.id === p.taskId)!;
      return {
        id: "",
        userId,
        sourceType: "task" as const,
        sourceId: p.taskId,
        title: task.title,
        startsAt: p.start,
        endsAt: p.end,
        hardness: "soft" as const,
        pinned: false,
        location: null,
        runId: null,
      };
    }),
    unplaceable: result.unplaceable,
    atRisk: result.atRisk,
    habitShortfall: [],
    derivedReminders: [],
    movedCount: result.movedCount,
  };
}

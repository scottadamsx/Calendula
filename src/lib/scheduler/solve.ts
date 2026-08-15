import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { computeGrid, type Block, type SourceType } from "./grid";
import { solveCore, type TaskInput } from "./solveCore";
import { placeHabits, type HabitInput, type HabitSession } from "./placeHabits";
import type { EnergyLabel, SolveOptions, SolveResult } from "./types";

/**
 * Pure function: inputs in, result out, no module-level state (spec §4, §7.1).
 * `userId` is always explicit — nothing reads "current user" implicitly.
 *
 * DB access lives here rather than in solveCore.ts/placeHabits.ts (the actual
 * algorithms, spec §7.2/§7.3/§7.4) so they stay testable without a database —
 * same split as buildGrid.ts / grid.ts. Habits run as a second pass after
 * tasks, against whatever blocks the task solver left free (spec §7.4).
 *
 * `derivedReminders` (Phase 6.5) is always empty — honest about what's
 * actually implemented, not a placeholder lie.
 *
 * Third parameter is a minor addition beyond the spec's literal §7.1
 * signature: `solve()` defaults to the cookie-bound client (a real request
 * made on behalf of a signed-in browser session), but crons re-solving on
 * behalf of *other* users (e.g. after expiring a meeting offer) have no such
 * session — they must pass a service-role client explicitly. Silently
 * falling back to the cookie client in that context wouldn't crash, it would
 * just see an unauthenticated session and RLS would return zero rows for
 * everything, which is a much worse failure mode than a clear error.
 */
export async function solve(
  userId: string,
  opts?: SolveOptions,
  client?: SupabaseClient,
): Promise<SolveResult> {
  const supabase = client ?? (await createClient());
  const dryRun = opts?.dryRun ?? false;

  // None of these five reads depend on each other, so they run concurrently
  // rather than as separate network round-trips — over a real connection to
  // a remote pooler, five sequential reads plus a delete was most of why a
  // solve took ~10s in practice, not the algorithm itself.
  const [
    { data: profile, error: profileError },
    { data: energyWindows, error: energyError },
    { data: tasks, error: tasksError },
    { data: habits, error: habitsError },
    { data: calibrationRows, error: calibrationError },
  ] = await Promise.all([
    supabase
      .from("calendula_scheduling_profile")
      .select(
        "timezone, sleep_start, sleep_end, block_minutes, freeze_window_hours, horizon_days, max_task_minutes_per_day, movement_penalty, min_break_minutes",
      )
      .eq("user_id", userId)
      .single(),
    supabase
      .from("calendula_energy_windows")
      .select("day_of_week, start_time, end_time, quality, label")
      .eq("user_id", userId),
    supabase
      .from("calendula_tasks")
      .select(
        "id, category_id, title, remaining_minutes, deadline, priority, min_chunk_minutes, max_chunk_minutes, splittable, preferred_labels, status",
      )
      .eq("user_id", userId)
      .eq("status", "active")
      .gt("remaining_minutes", 0),
    supabase
      .from("calendula_habits")
      .select(
        "id, title, duration_minutes, target_sessions_per_week, min_spacing_hours, preferred_labels, earliest_time, latest_time",
      )
      .eq("user_id", userId)
      .eq("active", true),
    supabase.from("calendula_duration_calibration").select("category_id, multiplier").eq("user_id", userId),
  ]);

  if (profileError || !profile) {
    throw new Error(`No calendula_scheduling_profile for user ${userId}; cannot solve.`);
  }
  if (energyError) throw energyError;
  if (tasksError) throw tasksError;
  if (habitsError) throw habitsError;
  if (calibrationError) throw calibrationError;

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + profile.horizon_days * 24 * 60 * 60_000);
  const freezeUntil = new Date(now.getTime() + profile.freeze_window_hours * 60 * 60_000);

  // D2/D7: every solve recomputes the full horizon from scratch, except
  // anything inside the freeze window, which never moves without
  // confirmation. dryRun never writes — it simulates against what's there.
  // Covers both task and habit soft placements — the only two sources a
  // solver produces.
  if (!dryRun) {
    const { error: deleteError } = await supabase
      .from("calendula_placements")
      .delete()
      .eq("user_id", userId)
      .in("source_type", ["task", "habit"])
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

  // dryRun never deleted anything above, so task/habit-sourced soft
  // placements outside the freeze window are still present here and must be
  // excluded from the grid by hand — otherwise the solver would see its own
  // old placements as pre-occupied and never get a chance to re-place them.
  const isSolverSourced = (p: { source_type: string; hardness: string }) =>
    (p.source_type === "task" || p.source_type === "habit") && p.hardness === "soft";
  const gridPlacements = dryRun
    ? (existingPlacements ?? []).filter(
        (p) => !(isSolverSourced(p) && new Date(p.starts_at) >= freezeUntil),
      )
    : existingPlacements ?? [];

  const previousTaskPlacements = (existingPlacements ?? []).filter(
    (p) => p.source_type === "task" && p.hardness === "soft",
  );

  // Frozen/preserved habit sessions still on the grid — used both for the
  // weekly-count and the spacing check against sessions the habit pass
  // itself doesn't get to re-place this run.
  const existingHabitSessions = (existingPlacements ?? [])
    .filter((p) => p.source_type === "habit" && p.hardness === "soft")
    .map((p): HabitSession => ({ habitId: p.source_id, start: new Date(p.starts_at), end: new Date(p.ends_at) }));
  const existingSessionsByHabitId = new Map<string, HabitSession[]>();
  for (const s of existingHabitSessions) {
    const list = existingSessionsByHabitId.get(s.habitId) ?? [];
    list.push(s);
    existingSessionsByHabitId.set(s.habitId, list);
  }

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
      sourceType: p.source_type as SourceType,
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

  // Habit pass — second, after tasks, against whatever blocks are still
  // free (spec §7.4). Same `blocks` array: task placements already marked
  // their blocks 'soft' above, so the habit pass can't collide with them.
  const habitInputs: HabitInput[] = (habits ?? []).map((h) => ({
    id: h.id,
    title: h.title,
    durationMinutes: h.duration_minutes,
    targetSessionsPerWeek: h.target_sessions_per_week,
    minSpacingHours: h.min_spacing_hours,
    preferredLabels: (h.preferred_labels ?? []) as EnergyLabel[],
    earliestTime: h.earliest_time,
    latestTime: h.latest_time,
  }));

  const habitResult = placeHabits({
    now,
    horizonEnd,
    timezone: profile.timezone,
    blocks,
    habits: habitInputs,
    existingSessionsByHabitId,
  });

  // Writes below are all independent of each other (different tables, or
  // disjoint rows in the same one) — fired concurrently rather than one
  // round-trip at a time.
  if (!dryRun) {
    const taskRows = result.placements.map((p) => {
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
    const habitRows = habitResult.placements.map((p) => {
      const h = habitInputs.find((x) => x.id === p.habitId)!;
      return {
        user_id: userId,
        source_type: "habit" as const,
        source_id: p.habitId,
        title: h.title,
        starts_at: p.start.toISOString(),
        ends_at: p.end.toISOString(),
        hardness: "soft" as const,
        pinned: false,
      };
    });
    const placementRows = [...taskRows, ...habitRows];

    // Persist how much of each task is actually left — without this, a task
    // that already got placed still shows its full original remaining_minutes
    // forever, so the very next solve treats it as brand new and schedules it
    // *again* alongside whatever it already placed. That's a real bug this
    // caught live: a fully-placed task got a second, redundant placement on
    // the next solve, landing close enough to an unrelated task's placement
    // that a later grid's block quantization made them appear to collide.
    const unplaceableByTaskId = new Map(result.unplaceable.map((u) => [u.taskId, u.remainingMinutes]));
    const remainingUpdates = taskInputs
      .map((t) => ({ id: t.id, newRemaining: unplaceableByTaskId.get(t.id) ?? 0, oldRemaining: t.remainingMinutes }))
      .filter((t) => t.newRemaining !== t.oldRemaining)
      .map((t) =>
        supabase.from("calendula_tasks").update({ remaining_minutes: t.newRemaining }).eq("id", t.id),
      );

    const [placementsResult, auditResult, ...updateResults] = await Promise.all([
      placementRows.length > 0
        ? supabase.from("calendula_placements").insert(placementRows)
        : Promise.resolve({ error: null }),
      supabase.from("calendula_schedule_runs").insert({
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
      }),
      ...remainingUpdates,
    ]);

    if (placementsResult.error) throw placementsResult.error;
    if (auditResult.error) throw auditResult.error;
    for (const r of updateResults) if (r.error) throw r.error;
  }

  return {
    placements: [
      ...result.placements.map((p) => {
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
      ...habitResult.placements.map((p) => {
        const h = habitInputs.find((x) => x.id === p.habitId)!;
        return {
          id: "",
          userId,
          sourceType: "habit" as const,
          sourceId: p.habitId,
          title: h.title,
          startsAt: p.start,
          endsAt: p.end,
          hardness: "soft" as const,
          pinned: false,
          location: null,
          runId: null,
        };
      }),
    ],
    unplaceable: result.unplaceable,
    atRisk: result.atRisk,
    habitShortfall: habitResult.shortfall,
    derivedReminders: [],
    movedCount: result.movedCount,
  };
}

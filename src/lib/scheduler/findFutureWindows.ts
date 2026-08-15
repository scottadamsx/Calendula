import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { computeProjectedLoadForRange } from "./projectedLoad";
import {
  findCandidateWindows,
  scoreCandidateWindow,
  selectTopWindows,
  WEATHER_SCORE_FALLBACK,
  type ActivityTypeConstraints,
  type ScoredWindow,
} from "./futureWindows";

export interface FindFutureWindowsOptions {
  activityTypeId: string;
  horizonDays: number;
  count?: number; // default 3
}

/** spec §8.2. */
export async function findFutureWindows(
  userId: string,
  opts: FindFutureWindowsOptions,
  client?: SupabaseClient,
): Promise<ScoredWindow[]> {
  const supabase = client ?? (await createClient());

  const { data: activityType, error: typeError } = await supabase
    .from("calendula_activity_types")
    .select("id, min_duration_hours, requires_overnight, season_start, season_end, lead_time_days, weather_sensitive")
    .eq("id", opts.activityTypeId)
    .eq("user_id", userId)
    .single();
  if (typeError || !activityType) {
    throw new Error(`No calendula_activity_types row ${opts.activityTypeId} for user ${userId}.`);
  }

  const { data: profile, error: profileError } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone")
    .eq("user_id", userId)
    .single();
  if (profileError || !profile) {
    throw new Error(`No calendula_scheduling_profile for user ${userId}; cannot find future windows.`);
  }

  const now = new Date();
  const leadStart = new Date(now.getTime() + activityType.lead_time_days * 24 * 60 * 60_000);
  const horizonEnd = new Date(now.getTime() + opts.horizonDays * 24 * 60 * 60_000);
  // Extend the range 2 days past the horizon so the last candidate's
  // loadFlank (the 2 days after it) has real data instead of defaulting to 0.
  const rangeEnd = new Date(horizonEnd.getTime() + 2 * 24 * 60 * 60_000);
  // And 2 days before `now` so the first candidate's flank-before has data too.
  const rangeStart = new Date(now.getTime() - 2 * 24 * 60 * 60_000);

  const { loadByDay, hardDayFlags, deadlinePressureByDay } = await computeProjectedLoadForRange(
    userId,
    rangeStart,
    rangeEnd,
    supabase,
  );

  const constraints: ActivityTypeConstraints = {
    minDurationHours: activityType.min_duration_hours,
    requiresOvernight: activityType.requires_overnight,
    seasonStart: activityType.season_start ? formatMonthDay(activityType.season_start) : null,
    seasonEnd: activityType.season_end ? formatMonthDay(activityType.season_end) : null,
    leadTimeDays: activityType.lead_time_days,
    weatherSensitive: activityType.weather_sensitive,
  };

  const candidates = findCandidateWindows(now, horizonEnd, profile.timezone, constraints, hardDayFlags, leadStart);
  if (candidates.length === 0) return [];

  const { data: lastHold } = await supabase
    .from("calendula_activity_holds")
    .select("starts_at")
    .eq("user_id", userId)
    .eq("activity_type_id", opts.activityTypeId)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const daysSinceLastHold = lastHold
    ? (now.getTime() - new Date(lastHold.starts_at).getTime()) / (24 * 60 * 60_000)
    : Infinity;
  const restBonus = Math.min(daysSinceLastHold / 30, 1.0);

  const dayKeys = [...loadByDay.keys()].sort();
  const scored: ScoredWindow[] = candidates.map((c) => {
    const windowDayKeys = dayKeys.filter((d) => d >= c.startDay && d <= c.endDay);
    const loadIn = mean(windowDayKeys.map((d) => loadByDay.get(d) ?? 0));

    const startIdx = dayKeys.indexOf(c.startDay);
    const endIdx = dayKeys.indexOf(c.endDay);
    const flankKeys = [
      ...(startIdx >= 2 ? [dayKeys[startIdx - 2], dayKeys[startIdx - 1]] : dayKeys.slice(0, startIdx)),
      ...(endIdx >= 0 && endIdx + 2 < dayKeys.length ? [dayKeys[endIdx + 1], dayKeys[endIdx + 2]] : dayKeys.slice(endIdx + 1)),
    ].filter(Boolean);
    const loadFlank = flankKeys.length > 0 ? mean(flankKeys.map((d) => loadByDay.get(d) ?? 0)) : 0;

    const afterKeys = dayKeys.filter((d) => d > c.endDay).slice(0, 3);
    const deadlinePenalty = afterKeys.length > 0 ? Math.max(...afterKeys.map((d) => deadlinePressureByDay.get(d) ?? 0)) : 0;

    const score = scoreCandidateWindow({
      loadIn,
      loadFlank,
      deadlinePenalty,
      weatherScore: WEATHER_SCORE_FALLBACK,
      weatherSensitive: constraints.weatherSensitive,
      restBonus,
    });

    return {
      ...c,
      score,
      reasons: { loadIn, loadFlank, deadlinePenalty, weatherScore: WEATHER_SCORE_FALLBACK, restBonus },
    };
  });

  return selectTopWindows(scored, opts.count ?? 3, profile.timezone);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** activity_types.season_start/end are SQL `date` columns (year-agnostic in intent) — normalize to "MM-DD". */
function formatMonthDay(isoDate: string): string {
  return isoDate.slice(5, 10);
}

import { DateTime } from "luxon";

/**
 * Pure pieces of the future window planner (spec §8.1/§8.2). The far grid
 * runs at day granularity, not fifteen minutes — a separate, lighter model
 * from the main scheduling grid (grid.ts), not a reuse of it. DB access
 * (aggregating hours per day from placements/fixed_blocks/tasks) lives in
 * projectedLoad.ts/findFutureWindows.ts.
 */

const WAKING_HOURS_PER_DAY = 10;

export interface ProjectedLoadInput {
  hardHours: number;
  deadlinePressureMinutes: number;
  recoveryDebtHours: number;
}

/** spec §8.1 — normalised against ten waking productive hours, clamped [0,1]. */
export function projectedLoadCore(input: ProjectedLoadInput): number {
  const totalHours = input.hardHours + input.deadlinePressureMinutes / 60 + input.recoveryDebtHours;
  return Math.max(0, Math.min(1, totalHours / WAKING_HOURS_PER_DAY));
}

/**
 * spec §8.1's deadline-pressure weight: "rises linearly from 0 at ten days
 * out to 1.0 at the deadline." A deadline that has already passed relative
 * to `day`, or one more than 10 days out, contributes 0.
 */
export function deadlineProximityWeight(deadline: Date, day: Date): number {
  const daysUntil = (deadline.getTime() - day.getTime()) / (24 * 60 * 60_000);
  if (daysUntil < 0 || daysUntil > 10) return 0;
  return 1 - daysUntil / 10;
}

/**
 * spec §8.2: "weatherScore = forecast if within 10 days, else climate
 * normals for the date." No weather data source is configured — nothing in
 * the spec names one, and unlike push's VAPID keys (Phase 4.6), a real
 * forecast/climate-normals feed needs an external API account, the same
 * class of blocker as ANTHROPIC_API_KEY (flagged, not
 * routed around). Falls back to a neutral 0.5 — no signal either way — so
 * its `+0.4` term never biases the ranking until a real data source exists.
 * `scoreCandidateWindow` below still gates the whole term on
 * `weather_sensitive`, since the spec's own pseudocode never references
 * that column otherwise, which would make it dead data.
 */
export const WEATHER_SCORE_FALLBACK = 0.5;

export interface ActivityTypeConstraints {
  minDurationHours: number;
  requiresOvernight: boolean;
  seasonStart: string | null; // "MM-DD"
  seasonEnd: string | null;
  leadTimeDays: number;
  weatherSensitive: boolean;
}

export interface CandidateWindow {
  startDay: string; // ISO date
  endDay: string; // ISO date, inclusive
  lengthDays: number;
}

/**
 * spec §8.2's `ceil(min_duration_hours / 24)`, extended to also respect
 * `requires_overnight` — otherwise that column is read by nothing at all. A
 * short but explicitly overnight activity (e.g. min_duration_hours: 20,
 * requires_overnight: true) still needs >= 2 calendar days, not 1.
 */
function candidateLengthDays(constraints: ActivityTypeConstraints): number {
  const byDuration = Math.ceil(constraints.minDurationHours / 24);
  return constraints.requiresOvernight ? Math.max(byDuration, 2) : byDuration;
}

function isWithinSeason(day: DateTime, seasonStart: string | null, seasonEnd: string | null): boolean {
  if (!seasonStart || !seasonEnd) return true;
  const md = day.toFormat("MM-dd");
  if (seasonStart <= seasonEnd) return md >= seasonStart && md <= seasonEnd;
  return md >= seasonStart || md <= seasonEnd; // wraps New Year's (e.g. winter Nov-Feb)
}

/**
 * spec §8.2. `hardDayFlags`/`loadByDay` are keyed by ISO date (the
 * timezone-local calendar day, resolved by the caller) and must cover every
 * day from `from` through `to` inclusive.
 */
export function findCandidateWindows(
  from: Date,
  to: Date,
  timezone: string,
  constraints: ActivityTypeConstraints,
  hardDayFlags: Map<string, boolean>,
  leadStart: Date,
): CandidateWindow[] {
  const length = candidateLengthDays(constraints);
  const days: DateTime[] = [];
  let cursor = DateTime.fromJSDate(from, { zone: timezone }).startOf("day");
  const end = DateTime.fromJSDate(to, { zone: timezone }).startOf("day");
  while (cursor <= end) {
    days.push(cursor);
    cursor = cursor.plus({ days: 1 });
  }

  const leadStartDay = DateTime.fromJSDate(leadStart, { zone: timezone }).startOf("day");
  const candidates: CandidateWindow[] = [];

  for (let i = 0; i + length <= days.length; i++) {
    const windowDays = days.slice(i, i + length);
    if (windowDays[0] < leadStartDay) continue;
    if (!windowDays.every((d) => isWithinSeason(d, constraints.seasonStart, constraints.seasonEnd))) continue;
    if (windowDays.some((d) => hardDayFlags.get(d.toISODate() ?? "") === true)) continue;

    candidates.push({
      startDay: windowDays[0].toISODate() ?? "",
      endDay: windowDays[windowDays.length - 1].toISODate() ?? "",
      lengthDays: length,
    });
  }

  return candidates;
}

export interface ScoredWindow extends CandidateWindow {
  score: number;
  reasons: {
    loadIn: number;
    loadFlank: number;
    deadlinePenalty: number;
    weatherScore: number;
    restBonus: number;
  };
}

/** spec §8.2's score formula, isolated so findFutureWindows.ts can supply per-day aggregates. */
export function scoreCandidateWindow(input: {
  loadIn: number;
  loadFlank: number;
  deadlinePenalty: number;
  weatherScore: number;
  weatherSensitive: boolean;
  restBonus: number;
}): number {
  return (
    1.0 * (1 - input.loadIn) +
    0.5 * (1 - input.loadFlank) -
    0.8 * input.deadlinePenalty +
    0.4 * (input.weatherSensitive ? input.weatherScore : 0) +
    0.3 * input.restBonus
  );
}

/**
 * spec §8.2: "return the top `count`, enforcing at least 7 days separation
 * between suggestions." Same greedy shape as selectGreedy in
 * meetingOffers.ts — sort by score, skip anything too close to an
 * already-selected pick.
 */
export function selectTopWindows(scored: ScoredWindow[], count: number, timezone: string): ScoredWindow[] {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const selected: ScoredWindow[] = [];

  for (const candidate of sorted) {
    if (selected.length >= count) break;
    const candidateStart = DateTime.fromISO(candidate.startDay, { zone: timezone });
    const tooClose = selected.some((s) => {
      const selectedStart = DateTime.fromISO(s.startDay, { zone: timezone });
      return Math.abs(candidateStart.diff(selectedStart, "days").days) < 7;
    });
    if (tooClose) continue;
    selected.push(candidate);
  }

  return selected;
}

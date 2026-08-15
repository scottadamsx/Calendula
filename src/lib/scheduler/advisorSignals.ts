import { DateTime } from "luxon";

/**
 * Pure pieces of the advisor's signals (spec §11). The advisor itself is
 * explicitly "the LLM layer" — the *signals* underneath it (what's
 * overloaded, who's overdue, what's drifting) are deterministic facts, and
 * that's the design thesis (§1): "deterministic solvers, LLM only at the
 * edges." Prose rendering here is the same documented fallback treatment as
 * `formatOfferMessage`/`formatDigestMessage` — no `ANTHROPIC_API_KEY`
 * configured, so Haiku/Sonnet/Opus routing (§11's "Model routing") isn't
 * built; these functions produce the honest, always-available default the
 * advisor page shows instead.
 */

export interface OverloadCandidate {
  taskId: string;
  title: string;
  priority: number;
  slackMinutes: number;
}

/**
 * spec §11: "ranked by priority ascending, slack descending." Task
 * priority is 1-5 where 5 is most important (solveCore.ts places higher
 * priority numbers first, tied on slack) — so priority *ascending* here
 * means least-important tasks are suggested to drop first, and slack
 * *descending* breaks ties toward whichever has the most room to spare.
 */
export function rankOverloadTasks(candidates: OverloadCandidate[]): OverloadCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.slackMinutes - a.slackMinutes;
  });
}

/**
 * spec §11: "Overload proposals must name the specific task to drop or
 * defer... Never 'you have a lot on.'" Overload is a computed fact, not an
 * opinion — this states it plainly, no editorializing.
 */
export function formatOverloadMessage(ranked: OverloadCandidate[]): string {
  if (ranked.length === 0) return "";
  const names = ranked.slice(0, 3).map((c) => `"${c.title}"`);
  const joined =
    names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} or ${names[1]}` : `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
  return `Not everything fits before its deadline. Drop or defer ${joined} first — those have the most room to give.`;
}

export interface RelationshipDrift {
  personName: string;
  daysSince: number;
  desiredCadenceDays: number;
  freeSlot: { start: Date; end: Date } | null;
}

/** spec §11's own example shape: "You and Nick are three weeks out. Wednesday 7pm is open and costs you nothing. Movie?" */
export function formatDriftMessage(drift: RelationshipDrift, timezone: string): string {
  const weeks = Math.floor(drift.daysSince / 7);
  const timeSince = weeks >= 1 ? `${weeks} week${weeks === 1 ? "" : "s"}` : `${drift.daysSince} day${drift.daysSince === 1 ? "" : "s"}`;
  const base = `You and ${drift.personName} are ${timeSince} out.`;
  if (!drift.freeSlot) return `${base} Nothing open nearby to suggest yet.`;
  const slotText = DateTime.fromJSDate(drift.freeSlot.start, { zone: timezone }).toFormat("cccc h:mma").toLowerCase();
  return `${base} ${slotText[0].toUpperCase()}${slotText.slice(1)} is open and costs you nothing.`;
}

/**
 * spec §11's trigger is "multiplier moved > 20%" against `duration_
 * calibration`, but the schema has no history to compare a run against —
 * only the current value. Read as drift from the neutral baseline (1.0,
 * the schema's own default before any calibration exists) rather than a
 * run-over-run delta the schema can't express: `abs(multiplier - 1.0) >
 * 0.2`. Matches the spec's own example ("You usually run 1.4× on
 * coursework" — 1.4 vs. the 1.0 baseline is exactly a 40% drift).
 */
export function isEstimateDrifted(multiplier: number): boolean {
  return Math.abs(multiplier - 1.0) > 0.2;
}

export function formatEstimateDriftMessage(categoryName: string, multiplier: number): string {
  return `You usually run ${multiplier.toFixed(1)}× on ${categoryName}.`;
}

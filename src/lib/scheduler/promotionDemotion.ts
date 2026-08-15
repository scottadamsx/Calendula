import { DateTime } from "luxon";

/**
 * Pure pieces of promotion/demotion (spec §10.6). "The advisor proposes,
 * draft-only" — the proposal text and the initial duration estimate are
 * both LLM work per the spec ("the initial estimate is LLM-proposed from
 * the title and category"), unavailable without `ANTHROPIC_API_KEY`. Same
 * documented-fallback treatment as every other LLM-gated piece in this
 * project: a fixed, honest default instead of a fabricated-sounding guess.
 */

export interface PromotionCandidate {
  reminderId: string;
  title: string;
  deferCount: number;
  createdAt: Date;
}

/** spec §10.6: `defer_count >= promote_after_defers` OR pending, non-latent, and over 7 days old. */
export function isPromotionCandidate(
  reminder: { status: string; kind: string; deferCount: number; createdAt: Date; promotionOffered: boolean },
  now: Date,
  promoteAfterDefers: number,
): boolean {
  if (reminder.promotionOffered || reminder.status !== "pending" || reminder.kind === "latent") return false;
  if (reminder.deferCount >= promoteAfterDefers) return true;
  const ageDays = (now.getTime() - reminder.createdAt.getTime()) / (24 * 60 * 60_000);
  return ageDays > 7;
}

/**
 * No `ANTHROPIC_API_KEY` — 45 minutes is the spec's own example figure
 * ("Schedule 45 minutes for it?"), used here as the fixed fallback default
 * rather than inventing a smarter-looking heuristic. Calibration (§12)
 * corrects it over time once real completions exist for the category, same
 * as any other task's estimate.
 */
export const DEFAULT_PROMOTED_TASK_MINUTES = 45;

export function formatPromotionProposal(candidate: PromotionCandidate): string {
  return `"${candidate.title}" has come up ${candidate.deferCount} time${candidate.deferCount === 1 ? "" : "s"}. That's probably not a 2-minute thing. Schedule ${DEFAULT_PROMOTED_TASK_MINUTES} minutes for it?`;
}

export interface DemotionCandidate {
  taskId: string;
  title: string;
  skipCount: number;
  estimatedMinutes: number;
}

/** spec §10.6: placed and skipped 3+ times, and estimated_minutes <= 30 — "it was never block-shaped work." */
export function isDemotionCandidate(
  task: { status: string; skipCount: number; estimatedMinutes: number; demotionOffered: boolean },
): boolean {
  return !task.demotionOffered && task.status === "active" && task.skipCount >= 3 && task.estimatedMinutes <= 30;
}

export function formatDemotionProposal(candidate: DemotionCandidate): string {
  return `"${candidate.title}" has been skipped ${candidate.skipCount} times — it was never block-shaped work. Turn it into a reminder instead?`;
}

/** A demoted task becomes a `moment` reminder due tomorrow morning — a nudge, not a scheduled block. */
export function demotedReminderDueAt(now: Date, timezone: string): Date {
  return DateTime.fromJSDate(now, { zone: timezone }).plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toJSDate();
}

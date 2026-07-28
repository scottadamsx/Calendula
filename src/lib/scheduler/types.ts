/** Shared solver types (spec §6, §7.1). Mirrors the DB schema in §5. */

export type Hardness = "hard" | "soft" | "tentative";
export type EnergyLabel = "deep" | "admin" | "social" | "physical" | "creative";

export interface Range {
  start: Date;
  end: Date;
}

export interface Placement {
  id: string;
  userId: string;
  sourceType: "fixed" | "task" | "habit" | "activity_hold" | "meeting_hold" | "meeting";
  sourceId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  hardness: Hardness;
  pinned: boolean;
  location: string | null;
  runId: string | null;
}

export type ReminderKind = "moment" | "window" | "context" | "latent";

export interface Reminder {
  id: string;
  userId: string;
  title: string;
  kind: ReminderKind;
  dueAt: Date | null;
}

export interface SolveResult {
  placements: Placement[];
  unplaceable: { taskId: string; remainingMinutes: number; deadline: Date | null }[];
  atRisk: { taskId: string; slackMinutes: number }[];
  habitShortfall: { habitId: string; missing: number }[];
  derivedReminders: Reminder[];
  movedCount: number;
}

export interface SolveOptions {
  excludeRanges?: Range[];
  dryRun?: boolean;
  /**
   * Minor addition beyond the spec's literal §7.1 signature: schedule_runs
   * (§5.10) has a `trigger` column, and only the dispatcher's caller knows
   * what to put there. Defaults to "manual" if omitted.
   */
  trigger?: string;
}

import { DateTime } from "luxon";
import type { Block } from "./grid";

/**
 * Pure pieces of the reminders engine (spec §10.2–§10.4). Reads the same
 * grid the solvers do — no parallel infrastructure, per §10.2's own note.
 * The DB-touching parts (fetching profiles/reminders, writing
 * reminder_deliveries) live in assignReminders.ts.
 */

export type ReminderKind = "moment" | "window" | "context" | "latent";

export interface AttentionProfile {
  attentionBudgetPerDay: number;
  minGapMinutes: number;
  quietStart: string | null; // "HH:mm"
  quietEnd: string | null;
  batchByDefault: boolean;
  promoteAfterDefers: number;
}

export interface ReminderCandidate {
  id: string;
  kind: ReminderKind;
  dueAt: Date | null;
  windowStart: Date | null;
  windowEnd: Date | null;
  /** Resolved start of trigger_placement_id, for `context` reminders (spec §10.3). */
  triggerPlacementStart: Date | null;
  leadMinutes: number;
  importance: number; // 1-5
  deferCount: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function isWithinWrappingRange(time: string, start: string, end: string): boolean {
  if (start <= end) return time >= start && time < end;
  return time >= start || time < end;
}

export interface ReceptivityContext {
  timezone: string;
  /** True if this block sits immediately before/after a hard placement — "the seam between two things" (§10.2). */
  isNearBoundary: boolean;
  /** Real deliveries (delivered_at set) so far today, independent of which reminder is being scored. */
  deliveredCountToday: number;
  minutesSinceLastDelivery: number | null;
  /** The reminder being scored for this pair — needed for the budget modifier's importance-5 override (see comment below). */
  importance: number;
}

/**
 * spec §10.2. The pseudocode signature is `receptivity(block, profile)`, but
 * one of its own modifiers — "-all if today's delivered count >= budget,
 * unless importance = 5" — can't be evaluated without knowing which reminder
 * is being scored. Read literally, a maxed-out day would zero receptivity
 * for every block including importance-5 ones, which would make the
 * assignment loop's own explicit importance-5 override (§10.4) dead code.
 * Resolved the same way as the other underspecified helpers in this codebase
 * (`sumSlackDelta`, `effectiveDeadline` below): receptivity is scored inside
 * the assignment loop's per-(reminder, block) pass anyway, so it has the
 * current reminder's importance available even though the abbreviated
 * pseudocode signature doesn't show it.
 *
 * Also: the "+0.15 block is a travel buffer" modifier is structurally
 * unreachable under the existing grid model — computeGrid (Phase 1) already
 * folds travel-buffer padding into `state: "unavailable"`, which this
 * function's own hard floor returns 0 for before any modifier would apply.
 * Not reproduced here; revisiting it means revisiting Phase 1's block
 * semantics, out of scope for this phase.
 */
export function receptivity(block: Block, profile: AttentionProfile, ctx: ReceptivityContext): number {
  if (block.state === "unavailable" || block.state === "hard" || block.state === "tentative") return 0;

  let score: number;
  if (block.state === "soft") {
    score = block.labels.includes("admin") ? 0.55 : 0.15; // deep-labelled or unlabelled soft blocks stay protected
  } else {
    score = 0.85; // free
  }

  if (ctx.isNearBoundary) score += 0.25;

  const local = DateTime.fromJSDate(block.start, { zone: ctx.timezone });
  const time = local.toFormat("HH:mm");
  if (profile.quietStart && profile.quietEnd && isWithinWrappingRange(time, profile.quietStart, profile.quietEnd)) {
    score -= 0.3;
  }

  if (ctx.minutesSinceLastDelivery !== null && ctx.minutesSinceLastDelivery < profile.minGapMinutes) {
    score -= 0.2;
  }

  if (ctx.deliveredCountToday >= profile.attentionBudgetPerDay && ctx.importance < 5) {
    return 0;
  }

  return clamp(score, 0, 1);
}

/**
 * Referenced by §10.4 ("if b.start > effectiveDeadline(r): continue") but
 * never defined. Interpretation: the last moment it's still meaningful to
 * surface this reminder. `moment` -> due_at itself, matching the phase's own
 * acceptance criterion verbatim ("no reminder is ever scheduled after its
 * due_at"). `window` -> window_end, the end of the range it was meant to
 * fire within. `context` -> the trigger placement's start, since urgency
 * for a context reminder is only ever nonzero up to that instant (§10.3).
 * `latent` -> null; latent reminders are filtered out of candidates before
 * this is ever called (kind != 'latent', §10.4), so it's unreachable there.
 */
export function effectiveDeadline(r: ReminderCandidate): Date | null {
  switch (r.kind) {
    case "moment":
      return r.dueAt;
    case "window":
      return r.windowEnd;
    case "context":
      return r.triggerPlacementStart;
    case "latent":
      return null;
  }
}

/** spec §10.3. */
export function urgency(r: ReminderCandidate, t: Date): number {
  let u: number;

  if (r.kind === "latent") {
    return 0;
  } else if (r.kind === "moment") {
    if (!r.dueAt) return 0;
    const timeLeftMs = r.dueAt.getTime() - t.getTime() - r.leadMinutes * 60_000;
    const horizonMs = 24 * 60 * 60_000 * r.importance;
    u = clamp(1 - timeLeftMs / horizonMs, 0, 1);
  } else if (r.kind === "window") {
    if (!r.windowStart || !r.windowEnd) return 0;
    const total = r.windowEnd.getTime() - r.windowStart.getTime();
    const elapsed = t.getTime() - r.windowStart.getTime();
    u = total > 0 ? Math.max(0.2, clamp(elapsed / total, 0, 1)) : 0.2;
  } else {
    // context
    if (!r.triggerPlacementStart) return 0;
    const minutesUntil = (r.triggerPlacementStart.getTime() - t.getTime()) / 60_000;
    u = minutesUntil >= 0 && minutesUntil <= r.leadMinutes ? 1.0 : 0;
  }

  u = u * (0.6 + 0.1 * r.importance);
  u += 0.08 * r.deferCount;
  return clamp(u, 0, 1);
}

function computeBoundaryFlags(blocks: Block[]): boolean[] {
  const isHardCommitment = (b: Block) => b.state === "hard" || b.state === "tentative";
  return blocks.map((b, i) => {
    if (isHardCommitment(b)) return false;
    const prev = blocks[i - 1];
    const next = blocks[i + 1];
    return Boolean((prev && isHardCommitment(prev)) || (next && isHardCommitment(next)));
  });
}

export interface ReminderAssignment {
  reminderId: string;
  blockStart: Date;
  blockEnd: Date;
  urgency: number;
  receptivity: number;
  value: number;
}

export interface AssignmentDeliveryContext {
  timezone: string;
  deliveredCountToday: number;
  minutesSinceLastDelivery: number | null;
}

/**
 * spec §10.4, run against the pre-built 48h grid. Candidates are assumed
 * already filtered to `kind != 'latent'` and not already carrying a live
 * scheduled delivery — both are the DB wrapper's job (assignReminders.ts),
 * since neither needs a grid.
 */
export function assignRemindersCore(
  candidates: ReminderCandidate[],
  blocks: Block[],
  profile: AttentionProfile,
  now: Date,
  ctx: AssignmentDeliveryContext,
): ReminderAssignment[] {
  const boundaryFlags = computeBoundaryFlags(blocks);
  const budget = Math.max(0, profile.attentionBudgetPerDay - ctx.deliveredCountToday);

  interface Pair {
    reminder: ReminderCandidate;
    block: Block;
    value: number;
    u: number;
    rcp: number;
  }
  const pairs: Pair[] = [];

  for (const reminder of candidates) {
    const deadline = effectiveDeadline(reminder);
    blocks.forEach((block, i) => {
      if (block.start < now) return; // grid snapping can place the first block slightly before `now`
      const rcp = receptivity(block, profile, {
        timezone: ctx.timezone,
        isNearBoundary: boundaryFlags[i],
        deliveredCountToday: ctx.deliveredCountToday,
        minutesSinceLastDelivery: ctx.minutesSinceLastDelivery,
        importance: reminder.importance,
      });
      if (rcp <= 0.2) return;
      if (deadline && block.start > deadline) return; // never deliver late
      const u = urgency(reminder, block.start);
      pairs.push({ reminder, block, value: u * rcp, u, rcp });
    });
  }

  pairs.sort((a, b) => b.value - a.value);

  const assignedReminderIds = new Set<string>();
  const assigned: Pair[] = [];

  for (const pair of pairs) {
    if (assignedReminderIds.has(pair.reminder.id)) continue;
    if (assigned.length >= budget && pair.reminder.importance < 5) continue;
    const tooClose = assigned.some(
      (a) => Math.abs(a.block.start.getTime() - pair.block.start.getTime()) < profile.minGapMinutes * 60_000,
    );
    if (tooClose) continue;
    assigned.push(pair);
    assignedReminderIds.add(pair.reminder.id);
  }

  return assigned.map((a) => ({
    reminderId: a.reminder.id,
    blockStart: a.block.start,
    blockEnd: a.block.end,
    urgency: a.u,
    receptivity: a.rcp,
    value: a.value,
  }));
}

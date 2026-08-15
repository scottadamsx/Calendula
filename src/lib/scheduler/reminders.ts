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

/**
 * A "free run" (§10.5's batching criterion) — a maximal contiguous stretch
 * of non-hard-commitment blocks, bounded on both ends by a hard/tentative/
 * unavailable block (or the edge of the grid). Blocks inside a commitment
 * get run id -1 — never a delivery candidate anyway, so it's unreachable
 * there, but explicit rather than left undefined.
 */
function computeRunIds(blocks: Block[]): number[] {
  const isCommitment = (b: Block) => b.state === "hard" || b.state === "tentative" || b.state === "unavailable";
  let runId = -1;
  let inRun = false;
  return blocks.map((b) => {
    if (isCommitment(b)) {
      inRun = false;
      return -1;
    }
    if (!inRun) {
      runId++;
      inRun = true;
    }
    return runId;
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
  const runIds = computeRunIds(blocks);
  const budget = Math.max(0, profile.attentionBudgetPerDay - ctx.deliveredCountToday);

  interface Pair {
    reminder: ReminderCandidate;
    block: Block;
    runId: number;
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
      pairs.push({ reminder, block, runId: runIds[i], value: u * rcp, u, rcp });
    });
  }

  pairs.sort((a, b) => b.value - a.value);

  const BATCH_WINDOW_MS = 20 * 60_000;
  const assignedReminderIds = new Set<string>();
  const assigned: Pair[] = [];

  for (const pair of pairs) {
    if (assignedReminderIds.has(pair.reminder.id)) continue;
    if (assigned.length >= budget && pair.reminder.importance < 5) continue;
    const tooClose = assigned.some((a) => {
      const distanceMs = Math.abs(a.block.start.getTime() - pair.block.start.getTime());
      if (distanceMs >= profile.minGapMinutes * 60_000) return false;
      // Within min_gap_minutes of an already-assigned delivery — normally
      // rejected (§10.4), but not when the two would batch into one digest
      // anyway (same free run, within the 20-minute batching window,
      // §10.5): they cost one real interruption together, not two spaced
      // ones, so the spacing rule has nothing to protect against here.
      // Without this exception, min_gap_minutes' 45-minute default is wider
      // than the 20-minute batch window, and batching could never trigger
      // at all under default settings — dead code for a feature the spec
      // frames as a core value proposition ("batching buys back budget").
      const batchable = profile.batchByDefault && a.runId === pair.runId && a.runId !== -1 && distanceMs <= BATCH_WINDOW_MS;
      return !batchable;
    });
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

export interface BatchedAssignment extends ReminderAssignment {
  batchId: string | null;
}

/**
 * spec §10.5. Runs as a distinct pass *after* assignment, purely for
 * dispatch grouping — it never changes which reminders got assigned or to
 * which blocks, only whether several of them fire together as one digest.
 *
 * "scheduled_at falls within the same 20-minute window" is read as: sort by
 * time, anchor a group on the earliest not-yet-grouped delivery, and fold in
 * every later one within 20 minutes of *that anchor* (and the same run).
 * Anchoring avoids two failure modes a naive approach hits: fixed
 * epoch-aligned buckets can split two deliveries 5 minutes apart if they
 * straddle a bucket edge (worse, in a UTC-offset-and-a-half zone like
 * America/St_Johns, "8:00 and 8:10 local" don't even land on a clean UTC
 * 20-minute boundary), and pairwise chaining (each within 20m of the
 * *previous* one) lets a group drift arbitrarily far from its first member.
 * "share a receptivity context (same boundary or same free run)" is read as
 * the same free run (computeRunIds) — a boundary block is, by construction,
 * always the first or last block of some run, so "same run" already
 * subsumes "same boundary" in this grid model; there's no case where two
 * blocks share a boundary without also sharing a run.
 */
export function applyBatching(assigned: ReminderAssignment[], blocks: Block[], batchByDefault: boolean): BatchedAssignment[] {
  if (!batchByDefault) return assigned.map((a) => ({ ...a, batchId: null }));

  const runIdByBlockStart = new Map<number, number>();
  computeRunIds(blocks).forEach((runId, i) => runIdByBlockStart.set(blocks[i].start.getTime(), runId));

  const withRun = assigned
    .map((a) => ({ ...a, runId: runIdByBlockStart.get(a.blockStart.getTime()) ?? -1 }))
    .sort((a, b) => a.blockStart.getTime() - b.blockStart.getTime());

  const WINDOW_MS = 20 * 60_000;
  const result: BatchedAssignment[] = [];
  let i = 0;
  while (i < withRun.length) {
    const anchor = withRun[i];
    const group = [anchor];
    let j = i + 1;
    while (
      j < withRun.length &&
      withRun[j].runId === anchor.runId &&
      withRun[j].blockStart.getTime() - anchor.blockStart.getTime() <= WINDOW_MS
    ) {
      group.push(withRun[j]);
      j++;
    }
    const batchId = group.length >= 2 ? crypto.randomUUID() : null;
    for (const a of group) result.push({ ...a, batchId });
    i = j;
  }
  return result;
}

/**
 * spec §10.5: "digest rendering is an LLM edge job (Haiku), given the
 * grouped reminders plus the next three placements." Not available without
 * ANTHROPIC_API_KEY (unset) — same deterministic-fallback treatment as
 * `formatOfferMessage` in meetingOffers.ts. Swap in a Haiku call once a key
 * exists; keep this as the always-available honest default.
 */
export function formatDigestMessage(
  reminderTitles: string[],
  nextPlacements: { title: string; start: Date }[],
  timezone: string,
): string {
  if (reminderTitles.length === 0) return "";
  const items = [...reminderTitles];
  if (nextPlacements.length > 0) {
    const next = nextPlacements[0];
    const time = DateTime.fromJSDate(next.start, { zone: timezone }).toFormat("h:mma").toLowerCase();
    items.push(`${next.title.toLowerCase()}'s at ${time}`);
  }
  const joined =
    items.length === 1
      ? items[0]
      : items.length === 2
        ? `${items[0]} and ${items[1]}`
        : `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
  return `${joined}.`;
}

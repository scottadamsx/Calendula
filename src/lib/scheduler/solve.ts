import type { SolveOptions, SolveResult } from "./types";

/**
 * Pure function: inputs in, result out, no module-level state (spec §4, §7.1).
 * `userId` is always explicit — nothing reads "current user" implicitly.
 *
 * Phase 0 stub: the grid engine (§6) and least-slack-time solver (§7.2) don't
 * exist yet, so this returns a no-op result. Every real caller goes through
 * `requestSolve` (dispatch.ts), never this function directly, so swapping
 * this body for the real algorithm in Phase 1/2 requires no caller changes.
 */
export async function solve(userId: string, opts?: SolveOptions): Promise<SolveResult> {
  void userId;
  void opts;

  return {
    placements: [],
    unplaceable: [],
    atRisk: [],
    habitShortfall: [],
    derivedReminders: [],
    movedCount: 0,
  };
}

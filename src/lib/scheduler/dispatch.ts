import { solve } from "./solve";
import type { SolveResult } from "./types";

const DEBOUNCE_MS = 2000;

interface PendingSolve {
  timer: ReturnType<typeof setTimeout>;
  resolvers: Array<(result: SolveResult) => void>;
}

/**
 * v1: inline, debounced 2s. Later: enqueue and return a job handle — callers
 * unchanged (spec §7.1). Every caller uses `requestSolve`, never `solve`
 * directly; that indirection is the entire multi-tenant migration path.
 *
 * This map is dispatcher state, not solver state — `solve()` itself stays a
 * pure function per §7.1's own rule. Collapsing rapid-fire triggers per user
 * within the debounce window is the dispatcher's one job in v1.
 */
const pending = new Map<string, PendingSolve>();

export async function requestSolve(userId: string, trigger: string): Promise<SolveResult> {
  // `trigger` isn't consumed yet — Phase 2 writes it into `schedule_runs`
  // once solve() has a database client to record the audit row against
  // (spec §5.10, §7.1). Kept in the signature now so callers don't change
  // when that lands.
  void trigger;

  return new Promise((resolve) => {
    const existing = pending.get(userId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.resolvers.push(resolve);
      existing.timer = setTimeout(() => fire(userId), DEBOUNCE_MS);
      return;
    }

    pending.set(userId, {
      resolvers: [resolve],
      timer: setTimeout(() => fire(userId), DEBOUNCE_MS),
    });
  });
}

async function fire(userId: string) {
  const entry = pending.get(userId);
  if (!entry) return;
  pending.delete(userId);
  const result = await solve(userId);
  entry.resolvers.forEach((resolve) => resolve(result));
}

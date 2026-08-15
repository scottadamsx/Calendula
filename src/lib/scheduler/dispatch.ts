import type { SupabaseClient } from "@supabase/supabase-js";
import { solve } from "./solve";
import type { SolveResult } from "./types";

const DEBOUNCE_MS = 2000;

interface PendingSolve {
  timer: ReturnType<typeof setTimeout>;
  resolvers: Array<(result: SolveResult) => void>;
  trigger: string;
  client?: SupabaseClient;
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

/**
 * `client` (optional, defaults to the cookie-bound session) is a minor
 * addition beyond §7.1's literal signature — see solve.ts's own comment.
 * Crons re-solving on behalf of a user with no active browser session pass
 * a service-role client explicitly.
 */
export async function requestSolve(
  userId: string,
  trigger: string,
  client?: SupabaseClient,
): Promise<SolveResult> {
  return new Promise((resolve) => {
    const existing = pending.get(userId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.resolvers.push(resolve);
      existing.trigger = trigger;
      if (client) existing.client = client;
      existing.timer = setTimeout(() => fire(userId), DEBOUNCE_MS);
      return;
    }

    pending.set(userId, {
      resolvers: [resolve],
      trigger,
      client,
      timer: setTimeout(() => fire(userId), DEBOUNCE_MS),
    });
  });
}

async function fire(userId: string) {
  const entry = pending.get(userId);
  if (!entry) return;
  pending.delete(userId);
  const result = await solve(userId, { trigger: entry.trigger }, entry.client);
  entry.resolvers.forEach((resolve) => resolve(result));
}

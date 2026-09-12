import { NextResponse, type NextRequest } from "next/server";
import { activeUsers } from "@/lib/scheduler/activeUsers";
import { solve } from "@/lib/scheduler/solve";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

/**
 * The cron leg of the fixed_blocks -> placements SPEC-GAP resolution
 * (CLAUDE.md). Not one of the spec's three named crons (§13: reminder
 * assignment, derived-reminder generation, meeting offer expiry) — a minor
 * addition, since nothing else keeps recurring fixed_blocks synced as time
 * moves forward and the horizon window slides with it. Runs nightly
 * (vercel.json); also triggered on-create from createFixedBlock so a newly
 * added block doesn't wait for the next cron tick.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const users = await activeUsers();
  const supabase = createServiceRoleClient();
  const now = new Date();
  const results: { userId: string; synced?: number; error?: string }[] = [];

  for (const { userId } of users) {
    try {
      // solve() syncs fixed-block placements itself before placing anything,
      // and then re-solves soft work around them — a bare sync could land a
      // new hard placement on top of an already-scheduled soft one and trip
      // the grid invariant on the next page load.
      const result = await solve(userId, { trigger: "cron_fixed_block_sync" }, supabase);
      results.push({ userId, synced: result.placements.length });
    } catch (err) {
      results.push({ userId, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return NextResponse.json({ ranAt: now.toISOString(), results });
}

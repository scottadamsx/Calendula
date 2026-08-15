import { NextResponse, type NextRequest } from "next/server";
import { activeUsers } from "@/lib/scheduler/activeUsers";
import { syncFixedBlockPlacements } from "@/lib/scheduler/fixedBlocks";
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
      const { data: profile } = await supabase
        .from("calendula_scheduling_profile")
        .select("horizon_days")
        .eq("user_id", userId)
        .single();
      const horizonDays = profile?.horizon_days ?? 14;
      const horizonEnd = new Date(now.getTime() + horizonDays * 24 * 60 * 60_000);
      const { synced } = await syncFixedBlockPlacements(userId, now, horizonEnd);
      results.push({ userId, synced });
    } catch (err) {
      results.push({ userId, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return NextResponse.json({ ranAt: now.toISOString(), results });
}

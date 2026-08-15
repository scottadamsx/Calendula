import { NextResponse, type NextRequest } from "next/server";
import { activeUsers } from "@/lib/scheduler/activeUsers";
import { runCalibration } from "@/lib/scheduler/runCalibration";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

/**
 * spec §12: "calibration, nightly per category." Not one of §13's three
 * named crons (reminder assignment, derived-reminder generation, meeting
 * offer expiry) — a minor addition, same tier as the fixed-blocks sync
 * cron: nothing else recomputes duration multipliers as check-ins accumulate.
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
  const results: { userId: string; categoriesUpdated?: number; error?: string }[] = [];

  for (const { userId } of users) {
    try {
      const { categoriesUpdated } = await runCalibration(userId, supabase);
      results.push({ userId, categoriesUpdated });
    } catch (err) {
      results.push({ userId, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}

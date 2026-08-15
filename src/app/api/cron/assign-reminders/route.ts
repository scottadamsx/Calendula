import { NextResponse, type NextRequest } from "next/server";
import { activeUsers } from "@/lib/scheduler/activeUsers";
import { assignReminders } from "@/lib/scheduler/assignReminders";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

/** spec §13 — one of the three named crons: "reminder assignment every 15 minutes." */
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
  const results: { userId: string; assignedCount?: number; error?: string }[] = [];

  for (const { userId } of users) {
    try {
      const { assignedCount } = await assignReminders(userId, supabase);
      results.push({ userId, assignedCount });
    } catch (err) {
      results.push({ userId, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}

import { NextResponse, type NextRequest } from "next/server";
import { activeUsers } from "@/lib/scheduler/activeUsers";
import { generateDerivedReminders } from "@/lib/scheduler/generateDerivedReminders";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

/** spec §13 — the second of the three named crons: "derived-reminder generation nightly." */
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
  const results: { userId: string; created?: number; error?: string }[] = [];

  for (const { userId } of users) {
    try {
      const { created } = await generateDerivedReminders(userId, supabase);
      results.push({ userId, created });
    } catch (err) {
      results.push({ userId, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}

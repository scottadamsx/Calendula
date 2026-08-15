import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

/**
 * The user set every cron iterates over (spec §13's cron shape: `for (const
 * user of await activeUsers())`) — v1 returns one row, but every cron is
 * still written as a loop so scaling to more users is a no-op later.
 */
export async function activeUsers(): Promise<{ userId: string }[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("calendula_scheduling_profile").select("user_id");
  if (error) throw error;
  return (data ?? []).map((row) => ({ userId: row.user_id }));
}

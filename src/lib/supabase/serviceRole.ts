import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client for trusted, server-only background work (ingestion,
 * cron) — bypasses RLS entirely. Never use this to serve a request on behalf
 * of a browser session; use `lib/supabase/server.ts` there so RLS scopes
 * every query to the authenticated `auth.uid()`.
 */
export function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requestSolve } from "./dispatch";
import { syncFixedBlockPlacements } from "./fixedBlocks";
import { planGoogleCalendarSync, type GoogleEvent, type ExistingImportedBlock } from "./googleCalendarSync";

export interface ApplyGoogleCalendarSyncResult {
  inserted: number;
  updated: number;
  deleted: number;
}

/**
 * DB wrapper applying `planGoogleCalendarSync`'s reconciliation to real
 * `fixed_blocks` rows, spec §16 Phase 7. Deliberately takes an already-
 * fetched `GoogleEvent[]` rather than calling the Google Calendar API
 * itself — the actual OAuth token exchange and API call aren't built (see
 * CLAUDE.md: no Google Cloud OAuth app exists, and unlike ANTHROPIC_API_KEY-
 * gated features there's no meaningful deterministic fallback for "pull
 * real calendar data" to fall back to). This function is where a real
 * `/api/calendar/import` route would hand off once that piece exists — the
 * reconciliation logic itself needed no live credentials to build or test.
 */
export async function applyGoogleCalendarSync(
  userId: string,
  events: GoogleEvent[],
  client?: SupabaseClient,
): Promise<ApplyGoogleCalendarSyncResult> {
  const supabase = client ?? (await createClient());

  const { data: existingRows, error: existingError } = await supabase
    .from("calendula_fixed_blocks")
    .select("id, external_id, title, starts_at, ends_at, location")
    .eq("user_id", userId)
    .eq("source", "google_calendar")
    .not("external_id", "is", null);
  if (existingError) throw existingError;

  const existingBlocks: ExistingImportedBlock[] = (existingRows ?? []).map((r) => ({
    id: r.id,
    externalId: r.external_id as string,
    title: r.title,
    starts_at: new Date(r.starts_at),
    ends_at: new Date(r.ends_at),
    location: r.location,
  }));

  const plan = planGoogleCalendarSync(events, existingBlocks);

  if (plan.toInsert.length > 0) {
    const { error } = await supabase.from("calendula_fixed_blocks").insert(
      plan.toInsert.map((e) => ({
        user_id: userId,
        title: e.title,
        starts_at: e.start.toISOString(),
        ends_at: e.end.toISOString(),
        location: e.location,
        source: "google_calendar",
        external_id: e.id,
      })),
    );
    if (error) throw error;
  }

  for (const u of plan.toUpdate) {
    const { error } = await supabase
      .from("calendula_fixed_blocks")
      .update({
        title: u.event.title,
        starts_at: u.event.start.toISOString(),
        ends_at: u.event.end.toISOString(),
        location: u.event.location,
      })
      .eq("id", u.blockId);
    if (error) throw error;
  }

  if (plan.toDelete.length > 0) {
    const blockIds = plan.toDelete.map((d) => d.blockId);
    const { error: placementError } = await supabase
      .from("calendula_placements")
      .delete()
      .eq("source_type", "fixed")
      .in("source_id", blockIds);
    if (placementError) throw placementError;
    const { error: blockError } = await supabase.from("calendula_fixed_blocks").delete().in("id", blockIds);
    if (blockError) throw blockError;
  }

  const changed = plan.toInsert.length > 0 || plan.toUpdate.length > 0 || plan.toDelete.length > 0;
  if (changed) {
    const { data: profile } = await supabase.from("calendula_scheduling_profile").select("horizon_days").eq("user_id", userId).single();
    const now = new Date();
    const horizonEnd = new Date(now.getTime() + (profile?.horizon_days ?? 14) * 24 * 60 * 60_000);
    await syncFixedBlockPlacements(userId, now, horizonEnd);
    await requestSolve(userId, "google_calendar_synced", supabase);
  }

  return { inserted: plan.toInsert.length, updated: plan.toUpdate.length, deleted: plan.toDelete.length };
}

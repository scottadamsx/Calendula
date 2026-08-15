"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { syncFixedBlockPlacements } from "@/lib/scheduler/fixedBlocks";

export interface CreateFixedBlockResult {
  ok: boolean;
  message: string;
}

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

export async function createFixedBlock(
  _prev: CreateFixedBlockResult | null,
  formData: FormData,
): Promise<CreateFixedBlockResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const title = String(formData.get("title") ?? "").trim();
  const startsRaw = String(formData.get("startsAt") ?? "");
  const endsRaw = String(formData.get("endsAt") ?? "");
  const repeatsWeekly = formData.get("repeatsWeekly") === "on";
  const location = String(formData.get("location") ?? "").trim() || null;

  if (!title) return { ok: false, message: "Title is required." };
  const startsAt = startsRaw ? new Date(startsRaw) : null;
  const endsAt = endsRaw ? new Date(endsRaw) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) {
    return { ok: false, message: "Start time isn't a valid date/time." };
  }
  if (!endsAt || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    return { ok: false, message: "End time must be a valid date/time after the start." };
  }

  const rrule = repeatsWeekly ? `FREQ=WEEKLY;BYDAY=${WEEKDAY_CODES[startsAt.getDay() === 0 ? 6 : startsAt.getDay() - 1]}` : null;

  const { data: profile } = await supabase
    .from("calendula_scheduling_profile")
    .select("horizon_days")
    .eq("user_id", user.id)
    .single();
  if (!profile) return { ok: false, message: "No scheduling profile — sign in again." };

  const { error: insertError } = await supabase.from("calendula_fixed_blocks").insert({
    user_id: user.id,
    title,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    location,
    rrule,
    source: "manual",
  });
  if (insertError) return { ok: false, message: insertError.message };

  // On-create trigger for the sync cron — see CLAUDE.md's resolved SPEC-GAP.
  // Same underlying function the cron calls per-user; here it runs once for
  // just this session's own user.id so a newly added block doesn't wait for
  // the next scheduled tick.
  const horizonEnd = new Date(Date.now() + profile.horizon_days * 24 * 60 * 60_000);
  const { synced } = await syncFixedBlockPlacements(user.id, new Date(), horizonEnd);
  revalidatePath("/week");

  return {
    ok: true,
    message: `"${title}" added${repeatsWeekly ? " (repeats weekly)" : ""} — ${synced} occurrence${synced === 1 ? "" : "s"} placed on the calendar.`,
  };
}

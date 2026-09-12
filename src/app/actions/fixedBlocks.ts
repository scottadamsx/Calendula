"use server";

import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import { syncFixedBlockPlacements, expandFixedBlock } from "@/lib/scheduler/fixedBlocks";
import { describeFixedBlockConflict } from "@/lib/scheduler/fixedBlockConflict";
import { requestSolve } from "@/lib/scheduler/dispatch";

export interface CreateFixedBlockResult {
  ok: boolean;
  message: string;
  id?: string;
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
  // A single "repeats weekly" checkbox only ever repeated on the exact day
  // of the start date — genuinely unusable for something like "work every
  // weekday," which shouldn't need five separate entries. Replaced with a
  // per-weekday picker; any subset of days (including all seven, or the
  // original single-day case) builds one BYDAY list.
  const repeatsOnDays = formData
    .getAll("repeatsOnDays")
    .map((v) => String(v))
    .filter((v): v is (typeof WEEKDAY_CODES)[number] => (WEEKDAY_CODES as readonly string[]).includes(v));
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

  const repeats = repeatsOnDays.length > 0;
  const rrule = repeats
    ? `FREQ=WEEKLY;BYDAY=${WEEKDAY_CODES.filter((code) => repeatsOnDays.includes(code)).join(",")}`
    : null;

  const { data: profile } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone, horizon_days, far_horizon_days")
    .eq("user_id", user.id)
    .single();
  if (!profile) return { ok: false, message: "No scheduling profile — sign in again." };

  // Reject an overlap at creation time rather than letting two genuinely-
  // conflicting hard commitments both reach `placements` — the grid engine's
  // "two placements can't claim the same block" invariant exists to catch
  // solver bugs, not to gracefully handle this, and hitting it live crashed
  // the whole page instead of asking for a different time.
  const conflictMessage = await describeFixedBlockConflict(supabase, user.id, profile, { startsAt, endsAt, rrule });
  if (conflictMessage) return { ok: false, message: conflictMessage };

  const { data: inserted, error: insertError } = await supabase
    .from("calendula_fixed_blocks")
    .insert({
      user_id: user.id,
      title,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      location,
      rrule,
      source: "manual",
    })
    .select("id")
    .single();
  if (insertError || !inserted) return { ok: false, message: insertError?.message ?? "Could not create the commitment." };

  // On-create trigger for the sync cron — see CLAUDE.md's resolved SPEC-GAP.
  // Same underlying function the cron calls per-user; here it runs once for
  // just this session's own user.id so a newly added block doesn't wait for
  // the next scheduled tick.
  const horizonEnd = new Date(Date.now() + profile.horizon_days * 24 * 60 * 60_000);
  await syncFixedBlockPlacements(user.id, new Date(), horizonEnd);
  // Count this block's own occurrences — the sync total covers every block
  // and once reported "11 occurrences" for a one-off dentist appointment.
  const own = expandFixedBlock({ id: "new", startsAt, endsAt, rrule }, profile.timezone, new Date(), horizonEnd);
  const first = own[0] ? DateTime.fromJSDate(own[0].start, { zone: profile.timezone }).toFormat("ccc LLL d, h:mma") : null;

  // A real bug found live: syncing only ever wrote *this* block's own hard
  // placement — it never gave the solver a chance to move an
  // already-scheduled soft task/habit placement out of the way if the new
  // hard commitment now lands on top of it. `syncFixedBlockPlacements`
  // can't do that itself (it only ever touches `source_type = 'fixed'`
  // rows); a real re-solve is the only thing that reconsiders soft
  // placements against the grid as it now stands.
  await requestSolve(user.id, "fixed_block_created", supabase);
  revalidatePath("/week");

  return {
    ok: true,
    id: inserted.id,
    message: repeats
      ? `"${title}" added, repeating weekly on ${repeatsOnDays.join(", ")}: ${own.length} occurrence${own.length === 1 ? "" : "s"} in the next ${profile.horizon_days} days${first ? `, first one ${first}` : ""}.`
      : `"${title}" added${first ? `: ${first}` : ""}.`,
  };
}

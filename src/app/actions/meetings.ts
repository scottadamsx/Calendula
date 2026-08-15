"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { requestSolve } from "@/lib/scheduler/dispatch";
import { findMeetingSlots } from "@/lib/scheduler/findMeetingSlots";
import { formatOfferMessage } from "@/lib/scheduler/meetingOffers";
import type { MeetingType } from "@/lib/scheduler/meetingOffers";

export interface CreateOfferResult {
  ok: boolean;
  message: string;
  offerId?: string;
}

/**
 * spec §9.2: a tentative placements row for *every* offered slot, inserted
 * before the schedule re-solves — otherwise the solver backfills the
 * offered slots overnight and whichever one gets picked is already
 * double-booked against the user's own planner.
 */
export async function createMeetingOffer(
  _prev: CreateOfferResult | null,
  formData: FormData,
): Promise<CreateOfferResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const purpose = String(formData.get("purpose") ?? "").trim() || null;
  const meetingType = String(formData.get("meetingType") ?? "work") as MeetingType;
  const durationMinutes = Number(formData.get("durationMinutes"));
  const horizonDays = Number(formData.get("horizonDays") ?? 7);
  const expiresInHours = Number(formData.get("expiresInHours") ?? 48);

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return { ok: false, message: "Duration must be a positive number of minutes." };
  }

  const { data: profile } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone")
    .eq("user_id", user.id)
    .single();
  if (!profile) return { ok: false, message: "No scheduling profile — sign in again." };

  const slots = await findMeetingSlots(user.id, { durationMinutes, meetingType, horizonDays });

  const { data: offer, error: offerError } = await supabase
    .from("calendula_meeting_offers")
    .insert({
      user_id: user.id,
      purpose,
      meeting_type: meetingType,
      duration_minutes: durationMinutes,
      expires_at: new Date(Date.now() + expiresInHours * 60 * 60_000).toISOString(),
      status: "open",
    })
    .select("id")
    .single();
  if (offerError || !offer) return { ok: false, message: offerError?.message ?? "Could not create the offer." };

  if (slots.length > 0) {
    const { data: placements, error: placeError } = await supabase
      .from("calendula_placements")
      .insert(
        slots.map((s) => ({
          user_id: user.id,
          source_type: "meeting_hold" as const,
          source_id: offer.id,
          title: purpose ?? "Meeting hold",
          starts_at: s.start.toISOString(),
          ends_at: s.end.toISOString(),
          hardness: "tentative" as const,
          pinned: false,
        })),
      )
      .select("id");
    if (placeError) return { ok: false, message: placeError.message };
    if (!placements || placements.length !== slots.length) {
      return { ok: false, message: "Placement holds didn't come back as expected — aborting." };
    }

    // Zipped by insert order, not by matching the returned starts_at string
    // against toISOString() — Postgres's returned timestamptz formatting
    // ("...+00:00") never matches JS's ("...Z"), so a string-keyed map here
    // silently produced null placement_id on every slot. A real bug caught
    // live: it meant confirming an offer never actually promoted the chosen
    // placement to hard, since confirmMeetingOffer's promotion is gated on
    // placement_id being set.
    const { error: slotsError } = await supabase.from("calendula_meeting_offer_slots").insert(
      slots.map((s, i) => ({
        user_id: user.id,
        offer_id: offer.id,
        starts_at: s.start.toISOString(),
        ends_at: s.end.toISOString(),
        displacement_cost: s.costMinutes,
        placement_id: placements[i].id,
      })),
    );
    if (slotsError) return { ok: false, message: slotsError.message };
  }

  await requestSolve(user.id, "meeting_offer_created");
  revalidatePath("/meetings");
  revalidatePath("/week");

  return {
    ok: true,
    offerId: offer.id,
    message: formatOfferMessage(slots, profile.timezone),
  };
}

export interface ConfirmOfferResult {
  ok: boolean;
  message: string;
}

/** spec §9.2 "Confirm". */
export async function confirmMeetingOffer(offerId: string, slotId: string): Promise<ConfirmOfferResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const { data: offer } = await supabase
    .from("calendula_meeting_offers")
    .select("id, person_ids")
    .eq("id", offerId)
    .eq("user_id", user.id)
    .single();
  if (!offer) return { ok: false, message: "Offer not found." };

  const { data: chosenSlot } = await supabase
    .from("calendula_meeting_offer_slots")
    .select("id, placement_id")
    .eq("id", slotId)
    .eq("offer_id", offerId)
    .single();
  if (!chosenSlot) return { ok: false, message: "Slot not found." };

  const { data: otherSlots } = await supabase
    .from("calendula_meeting_offer_slots")
    .select("id, placement_id")
    .eq("offer_id", offerId)
    .neq("id", slotId);

  if (chosenSlot.placement_id) {
    const { error } = await supabase
      .from("calendula_placements")
      .update({ hardness: "hard", source_type: "meeting" })
      .eq("id", chosenSlot.placement_id);
    if (error) return { ok: false, message: error.message };
  }

  const otherPlacementIds = (otherSlots ?? []).map((s) => s.placement_id).filter((id): id is string => Boolean(id));
  if (otherPlacementIds.length > 0) {
    const { error } = await supabase.from("calendula_placements").delete().in("id", otherPlacementIds);
    if (error) return { ok: false, message: error.message };
  }

  await supabase.from("calendula_meeting_offer_slots").update({ chosen: true }).eq("id", slotId);
  await supabase.from("calendula_meeting_offers").update({ status: "confirmed" }).eq("id", offerId);

  if (offer.person_ids && offer.person_ids.length > 0) {
    await supabase
      .from("calendula_people")
      .update({ last_interaction_at: new Date().toISOString() })
      .in("id", offer.person_ids);
  }

  await requestSolve(user.id, "meeting_confirmed");
  revalidatePath("/meetings");
  revalidatePath("/week");

  return { ok: true, message: "Confirmed — the other slots are released." };
}

/** Hourly cron (spec §13) — status='expired', tentative placements removed, affected users re-solved. */
export async function expireMeetingOffers(): Promise<{ expired: number }> {
  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();

  const { data: expiredOffers } = await supabase
    .from("calendula_meeting_offers")
    .select("id, user_id")
    .eq("status", "open")
    .lt("expires_at", now);

  if (!expiredOffers || expiredOffers.length === 0) return { expired: 0 };

  const offerIds = expiredOffers.map((o) => o.id);
  const { data: slots } = await supabase
    .from("calendula_meeting_offer_slots")
    .select("placement_id")
    .in("offer_id", offerIds);
  const placementIds = (slots ?? []).map((s) => s.placement_id).filter((id): id is string => Boolean(id));

  if (placementIds.length > 0) {
    await supabase.from("calendula_placements").delete().in("id", placementIds);
  }
  await supabase.from("calendula_meeting_offers").update({ status: "expired" }).in("id", offerIds);

  const affectedUsers = [...new Set(expiredOffers.map((o) => o.user_id))];
  for (const userId of affectedUsers) {
    // No browser session exists for a cron — pass the service-role client
    // explicitly rather than letting solve() default to the cookie-bound
    // one, which would silently see an unauthenticated session here.
    await requestSolve(userId, "meeting_offer_expired", supabase);
  }

  return { expired: expiredOffers.length };
}

import { DateTime } from "luxon";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { CreateOfferForm } from "@/components/meetings/CreateOfferForm";
import { ConfirmSlotButton } from "@/components/meetings/ConfirmSlotButton";

function NotConnected({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader eyebrow="Meetings" title="When are you free?" lead="Find and hold real meeting times." />
      <Panel>
        <p className="text-sm text-ink-soft">{children}</p>
      </Panel>
    </>
  );
}

const STATUS_TONE: Record<string, "info" | "success" | "neutral" | "danger"> = {
  open: "info",
  confirmed: "success",
  expired: "neutral",
};

export default async function MeetingsPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return (
      <NotConnected>
        No Supabase project configured yet — see{" "}
        <Link href="/connectors" className="text-brand-600 hover:text-brand-700 underline">
          Connectors
        </Link>
        .
      </NotConnected>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <NotConnected>
        No signed-in session.{" "}
        <Link href="/login" className="text-brand-600 hover:text-brand-700 underline">
          Sign in
        </Link>{" "}
        first.
      </NotConnected>
    );
  }

  const { data: profile } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone")
    .eq("user_id", user.id)
    .single();
  const timezone = profile?.timezone ?? "America/St_Johns";

  const { data: offers } = await supabase
    .from("calendula_meeting_offers")
    .select("id, purpose, meeting_type, duration_minutes, status, expires_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  const offerIds = (offers ?? []).map((o) => o.id);
  const { data: allSlots } =
    offerIds.length > 0
      ? await supabase
          .from("calendula_meeting_offer_slots")
          .select("id, offer_id, starts_at, ends_at, chosen")
          .in("offer_id", offerIds)
          .order("starts_at")
      : { data: [] };

  const slotsByOffer = new Map<string, typeof allSlots>();
  for (const slot of allSlots ?? []) {
    const list = slotsByOffer.get(slot.offer_id) ?? [];
    list.push(slot);
    slotsByOffer.set(slot.offer_id, list);
  }

  return (
    <>
      <PageHeader
        eyebrow="Meetings"
        title="When are you free?"
        lead="Find real slots and hold them until someone picks one — offered times are never quietly backfilled."
      />

      <div className="flex flex-col gap-4">
        <CreateOfferForm />

        <Panel>
          <h2 className="text-base font-semibold mb-3">Recent offers</h2>
          {(offers ?? []).length === 0 ? (
            <p className="text-xs text-ink-faint">Nothing yet — find a time above.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {(offers ?? []).map((offer) => (
                <li key={offer.id} className="border-b border-line last:border-0 pb-4 last:pb-0">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div>
                      <span className="text-sm font-semibold text-ink">
                        {offer.purpose || `${offer.meeting_type} meeting`}
                      </span>
                      <span className="font-data text-xs text-ink-soft ml-2">{offer.duration_minutes}min</span>
                    </div>
                    <Badge tone={STATUS_TONE[offer.status] ?? "neutral"}>{offer.status}</Badge>
                  </div>
                  {offer.status === "open" && (
                    <ul className="flex flex-col gap-2">
                      {(slotsByOffer.get(offer.id) ?? []).map((slot) => (
                        <li key={slot.id} className="flex items-center justify-between gap-2 pl-2 border-l-2 border-brand-600">
                          <span className="font-data text-xs text-ink-soft">
                            {DateTime.fromISO(slot.starts_at, { zone: timezone }).toFormat("cccc LLL d, h:mma")}–
                            {DateTime.fromISO(slot.ends_at, { zone: timezone }).toFormat("h:mma")}
                          </span>
                          <ConfirmSlotButton offerId={offer.id} slotId={slot.id} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

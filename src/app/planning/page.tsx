import { DateTime } from "luxon";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { AddActivityTypeForm } from "@/components/planning/AddActivityTypeForm";
import { FindWindowsForm } from "@/components/planning/FindWindowsForm";
import { ReleaseHoldButton } from "@/components/planning/ReleaseHoldButton";

function NotConnected({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader eyebrow="Planning" title="Defend time before it's gone" lead="Find and hold good windows for multi-day things, months out." />
      <Panel>
        <p className="text-sm text-ink-soft">{children}</p>
      </Panel>
    </>
  );
}

export default async function PlanningPage() {
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

  const { data: activityTypes } = await supabase
    .from("calendula_activity_types")
    .select("id, name")
    .eq("user_id", user.id)
    .order("name");

  const { data: holds } = await supabase
    .from("calendula_activity_holds")
    .select("id, starts_at, ends_at, status, activity_type_id")
    .eq("user_id", user.id)
    .eq("status", "held")
    .order("starts_at", { ascending: true });

  const nameByActivityTypeId = new Map((activityTypes ?? []).map((t) => [t.id, t.name]));

  return (
    <>
      <PageHeader
        eyebrow="Planning"
        title="Defend time before it's gone"
        lead="An empty weekend three months out isn't a free weekend if coursework is about to land there — this finds the actually-good windows and holds them, routing everything else around."
      />

      <div className="flex flex-col gap-4">
        <AddActivityTypeForm />
        <FindWindowsForm activityTypes={activityTypes ?? []} />

        <Panel>
          <h2 className="text-base font-semibold mb-3">Held</h2>
          {(holds ?? []).length === 0 ? (
            <p className="text-xs text-ink-faint">Nothing held yet — find a window above.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {(holds ?? []).map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 pb-3 border-b border-line last:border-0 last:pb-0">
                  <div>
                    <span className="text-sm font-medium text-ink">{nameByActivityTypeId.get(h.activity_type_id) ?? "Activity"}</span>
                    <div className="text-xs text-ink-soft mt-0.5 flex items-center gap-2">
                      <Badge tone="info">held</Badge>
                      <span className="font-data">
                        {DateTime.fromISO(h.starts_at, { zone: timezone }).toFormat("ccc LLL d")} –{" "}
                        {DateTime.fromISO(h.ends_at, { zone: timezone }).toFormat("ccc LLL d")}
                      </span>
                    </div>
                  </div>
                  <ReleaseHoldButton holdId={h.id} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

import { DateTime } from "luxon";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { CheckInButtons } from "@/components/checkin/CheckInButtons";

function NotConnected({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader eyebrow="Check-in" title="Did it actually happen?" lead="Under sixty seconds — this is what keeps estimates honest." />
      <Panel>
        <p className="text-sm text-ink-soft">{children}</p>
      </Panel>
    </>
  );
}

export default async function CheckInPage() {
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

  const { data: pastPlacements } = await supabase
    .from("calendula_placements")
    .select("id, source_type, title, starts_at, ends_at")
    .eq("user_id", user.id)
    .eq("hardness", "soft")
    .in("source_type", ["task", "habit"])
    .lt("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: false })
    .limit(50);

  const placementIds = (pastPlacements ?? []).map((p) => p.id);
  const { data: existingCompletions } =
    placementIds.length > 0
      ? await supabase.from("calendula_completions").select("placement_id").in("placement_id", placementIds)
      : { data: [] };
  const alreadyLogged = new Set((existingCompletions ?? []).map((c) => c.placement_id));

  const needsCheckIn = (pastPlacements ?? []).filter((p) => !alreadyLogged.has(p.id));

  return (
    <>
      <PageHeader
        eyebrow="Check-in"
        title="Did it actually happen?"
        lead="For everything the solver placed that's already passed — done or not, and how long it actually took. This is the only input the calibration model ever gets."
      />

      <Panel>
        <h2 className="text-base font-semibold mb-3">Needs a check-in</h2>
        {needsCheckIn.length === 0 ? (
          <p className="text-xs text-ink-faint">Nothing waiting — you&rsquo;re caught up.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {needsCheckIn.map((p) => {
              const plannedMinutes = Math.round((new Date(p.ends_at).getTime() - new Date(p.starts_at).getTime()) / 60_000);
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 pb-3 border-b border-line last:border-0 last:pb-0">
                  <div>
                    <span className="text-sm font-medium text-ink">{p.title}</span>
                    <div className="text-xs text-ink-soft mt-0.5 flex items-center gap-2">
                      <Badge tone="neutral">{p.source_type === "task" ? "Task" : "Habit"}</Badge>
                      <span className="font-data">
                        {DateTime.fromISO(p.starts_at, { zone: timezone }).toFormat("ccc LLL d, h:mma")} · {plannedMinutes}min planned
                      </span>
                    </div>
                  </div>
                  <CheckInButtons placementId={p.id} plannedMinutes={plannedMinutes} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}

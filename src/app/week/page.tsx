import { DateTime } from "luxon";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buildGrid } from "@/lib/scheduler/buildGrid";
import { mergeBySource } from "@/lib/scheduler/grid";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { WeekToolbar } from "@/components/week/WeekToolbar";
import { EventCard } from "@/components/week/EventCard";

const DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function NotConnected({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader
        eyebrow="Week"
        title="Week view"
        lead="Read-only (spec §16 Phase 1) — renders hard placements only. No auto-scheduling exists yet, so a mostly-empty week here is expected until Phase 2's task solver ships."
      />
      <Panel>
        <p className="text-sm text-ink-soft">{children}</p>
      </Panel>
    </>
  );
}

export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<{ weekOffset?: string }>;
}) {
  const { weekOffset: weekOffsetParam } = await searchParams;

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
        to see your schedule.
      </NotConnected>
    );
  }

  const { data: profile } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone, horizon_days")
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    return (
      <NotConnected>
        Signed in, but this user has no{" "}
        <code className="font-data">calendula_scheduling_profile</code> row yet. Run{" "}
        <code className="font-data">supabase/seed.sql</code> or create one.
      </NotConnected>
    );
  }

  const maxOffsetWeeks = Math.max(0, Math.floor(profile.horizon_days / 7) - 1);
  const requestedOffset = Number(weekOffsetParam ?? 0);
  const weekOffset = Number.isFinite(requestedOffset)
    ? Math.min(Math.max(requestedOffset, 0), maxOffsetWeeks)
    : 0;

  const weekStart = DateTime.now().setZone(profile.timezone).startOf("week").plus({ weeks: weekOffset });
  const weekEnd = weekStart.plus({ days: 7 });

  const blocks = await buildGrid(user.id, weekStart.toJSDate(), weekEnd.toJSDate());
  const placements = mergeBySource(blocks).filter((p) => p.state === "hard" || p.state === "soft");

  const today = DateTime.now().setZone(profile.timezone);
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = weekStart.plus({ days: i });
    const dayPlacements = placements
      .filter((p) => DateTime.fromJSDate(p.start, { zone: profile.timezone }).hasSame(day, "day"))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    return { day, dayPlacements };
  });

  return (
    <>
      <PageHeader
        eyebrow="Week"
        title={`Week of ${weekStart.toFormat("LLL d")}`}
        lead="Dark blocks are commitments and never move. Orange blocks are tasks and green blocks are habit sessions — the scheduler placed those and will move them as things change. Click anything to see it or delete it."
        action={
          <div className="flex gap-2 shrink-0">
            <Link
              href={`/week?weekOffset=${Math.max(weekOffset - 1, 0)}`}
              className="h-8 px-3 inline-flex items-center rounded-sm text-xs font-medium border border-line text-ink-soft hover:bg-brand-50"
            >
              ← Prev
            </Link>
            <Link
              href={`/week?weekOffset=${Math.min(weekOffset + 1, maxOffsetWeeks)}`}
              className="h-8 px-3 inline-flex items-center rounded-sm text-xs font-medium border border-line text-ink-soft hover:bg-brand-50"
            >
              Next →
            </Link>
          </div>
        }
      />

      <div className="mb-6">
        <WeekToolbar />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
        {days.map(({ day, dayPlacements }, i) => (
          <Panel key={day.toISODate()} className={`flex flex-col gap-3 ${day.hasSame(today, "day") ? "border-brand-400" : ""}`}>
            <div className="flex items-baseline justify-between">
              <div>
                <div className={`text-[10px] font-extrabold uppercase tracking-[.07em] ${day.hasSame(today, "day") ? "text-brand-700" : "text-ink-faint"}`}>
                  {DAY_LABELS[i]}{day.hasSame(today, "day") ? " · today" : ""}
                </div>
                <div className="text-sm font-semibold text-ink">{day.toFormat("LLL d")}</div>
              </div>
              {dayPlacements.length > 0 && <span className="font-data text-[11px] text-ink-faint">{dayPlacements.length}</span>}
            </div>

            {dayPlacements.length === 0 ? (
              <p className="text-xs text-ink-faint">Free.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {dayPlacements.map((p) => (
                  <li key={`${p.sourceId}-${p.start.toISOString()}`}>
                    <EventCard
                      sourceId={p.sourceId}
                      sourceType={p.sourceType ?? "task"}
                      title={p.title ?? "Untitled"}
                      startIso={p.start.toISOString()}
                      endIso={p.end.toISOString()}
                      state={p.state === "hard" ? "hard" : "soft"}
                      location={p.location}
                      timezone={profile.timezone}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ))}
      </div>
    </>
  );
}

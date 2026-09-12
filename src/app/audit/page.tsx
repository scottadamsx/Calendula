import Link from "next/link";
import { DateTime } from "luxon";
import { readFile } from "fs/promises";
import path from "path";
import { createClient } from "@/lib/supabase/server";
import { buildGrid } from "@/lib/scheduler/buildGrid";
import { mergeBySource } from "@/lib/scheduler/grid";
import { auditSchedule } from "@/lib/audit/scheduleAudit";
import type { BenchmarkSummary } from "@/lib/audit/benchmark";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";

async function loadBenchmark(): Promise<BenchmarkSummary | null> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "benchmark-results.json"), "utf8")) as BenchmarkSummary;
  } catch {
    return null;
  }
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-line bg-paper px-4 py-3">
      <div className="text-[10px] font-extrabold uppercase tracking-[.07em] text-ink-faint">{label}</div>
      <div className="font-data text-xl text-ink mt-1">{value}</div>
      {hint && <div className="text-xs text-ink-soft mt-0.5">{hint}</div>}
    </div>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ weekOffset?: string }> }) {
  const { weekOffset: weekOffsetParam } = await searchParams;
  const benchmark = await loadBenchmark();

  const header = (
    <PageHeader
      eyebrow="Audit"
      title="Does the schedule hold up?"
      lead="Six rules the solver must never break, checked against the real week you're looking at, plus the numbers that make one week comparable to another. Below that, how the solver scores against two naive schedulers on hundreds of randomized weeks."
    />
  );

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return (<>{header}<Panel><p className="text-sm text-ink-soft">No Supabase project configured yet — see <Link href="/connectors" className="text-brand-600 underline">Connectors</Link>.</p></Panel></>);
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return (<>{header}<Panel><p className="text-sm text-ink-soft">No signed-in session. <Link href="/login" className="text-brand-600 underline">Sign in</Link> first.</p></Panel></>);
  }

  const { data: profile } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone, sleep_start, sleep_end, max_task_minutes_per_day, horizon_days")
    .eq("user_id", user.id)
    .single();
  if (!profile) return (<>{header}<Panel><p className="text-sm text-ink-soft">No scheduling profile yet.</p></Panel></>);

  const maxOffsetWeeks = Math.max(0, Math.floor(profile.horizon_days / 7) - 1);
  const weekOffset = Math.min(Math.max(Number(weekOffsetParam ?? 0) || 0, 0), maxOffsetWeeks);
  const weekStart = DateTime.now().setZone(profile.timezone).startOf("week").plus({ weeks: weekOffset });
  const weekEnd = weekStart.plus({ days: 7 });

  const [blocks, { data: tasks }, { data: habits }] = await Promise.all([
    buildGrid(user.id, weekStart.toJSDate(), weekEnd.toJSDate()),
    supabase.from("calendula_tasks").select("id, title, deadline, remaining_minutes").eq("user_id", user.id).eq("status", "active"),
    supabase.from("calendula_habits").select("id, title, target_sessions_per_week, min_spacing_hours").eq("user_id", user.id).eq("active", true),
  ]);
  const placements = mergeBySource(blocks).filter((p) => p.state === "hard" || p.state === "soft");
  const { data: taskPlacements } = await supabase
    .from("calendula_placements")
    .select("source_id, starts_at")
    .eq("user_id", user.id)
    .eq("source_type", "task")
    .gte("ends_at", new Date().toISOString())
    .order("starts_at");
  const placedElsewhere = new Map<string, string>();
  for (const p of taskPlacements ?? []) {
    const start = DateTime.fromISO(p.starts_at, { zone: profile.timezone });
    if ((start < weekStart || start >= weekEnd) && !placedElsewhere.has(p.source_id)) placedElsewhere.set(p.source_id, start.toFormat("ccc LLL d"));
  }
  const titleToId = new Map((tasks ?? []).map((t) => [t.title, t.id]));

  const report = auditSchedule({
    from: weekStart.toJSDate(),
    to: weekEnd.toJSDate(),
    blocks,
    placements,
    tasks: (tasks ?? []).map((t) => ({ id: t.id, title: t.title, deadline: t.deadline ? new Date(t.deadline) : null, remainingMinutes: t.remaining_minutes })),
    habits: (habits ?? []).map((h) => ({ id: h.id, title: h.title, targetSessionsPerWeek: h.target_sessions_per_week, minSpacingHours: h.min_spacing_hours })),
    profile: { timezone: profile.timezone, sleepStart: profile.sleep_start, sleepEnd: profile.sleep_end, maxTaskMinutesPerDay: profile.max_task_minutes_per_day },
  });
  const m = report.metrics;

  return (
    <>
      <PageHeader
        eyebrow="Audit"
        title={`Week of ${weekStart.toFormat("LLL d")}: ${report.passed} of ${report.invariants.length} rules hold`}
        lead="Six rules the solver must never break, checked against this real week, plus the numbers that make one week comparable to another. Any red line here is a solver bug, not a preference."
        action={
          <div className="flex gap-2 shrink-0">
            <Link href={`/audit?weekOffset=${Math.max(weekOffset - 1, 0)}`} className="h-8 px-3 inline-flex items-center rounded-sm text-xs font-medium border border-line text-ink-soft hover:bg-brand-50">← Prev</Link>
            <Link href={`/audit?weekOffset=${Math.min(weekOffset + 1, maxOffsetWeeks)}`} className="h-8 px-3 inline-flex items-center rounded-sm text-xs font-medium border border-line text-ink-soft hover:bg-brand-50">Next →</Link>
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        <Panel>
          <h2 className="text-base font-semibold mb-3">Rules</h2>
          <ul className="flex flex-col divide-y divide-line">
            {report.invariants.map((inv) => (
              <li key={inv.id} className="py-2.5 first:pt-0 last:pb-0 flex items-start gap-3">
                <Badge tone={inv.pass ? "success" : "danger"}>{inv.pass ? "Holds" : "Broken"}</Badge>
                <div>
                  <div className="text-sm text-ink">{inv.label}</div>
                  <div className="text-xs text-ink-soft font-data">{inv.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <h2 className="text-base font-semibold mb-1">This week by the numbers</h2>
          <p className="text-xs text-ink-soft mb-4">Slack is hours between a task&rsquo;s last chunk and its deadline. Chunks is how split up a task is. Good-energy is the share of task time landing in your better hours.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Task hours scheduled" value={`${m.scheduledTaskHours}h`} />
            <Stat label="Habit sessions" value={`${m.scheduledHabitSessions}`} hint={m.habitAdherence.map((h) => `${h.title} ${h.sessions}/${h.target}`).join(" · ") || undefined} />
            <Stat label="Free hours" value={`${m.freeHours}h`} hint={m.largestFreeBlockByDay.length ? `biggest gap ${Math.max(...m.largestFreeBlockByDay.map((d) => d.minutes)) / 60}h` : undefined} />
            <Stat label="Tightest slack" value={m.minSlackHours === null ? "n/a" : `${m.minSlackHours}h`} hint={m.avgChunksPerTask === null ? undefined : `${m.avgChunksPerTask} chunks per task avg`} />
          </div>
          {m.taskSlack.length > 0 && (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] font-extrabold uppercase tracking-[.07em] text-ink-faint"><th className="py-1">Task</th><th className="py-1 text-right">Chunks</th><th className="py-1 text-right">Slack</th></tr></thead>
              <tbody>
                {m.taskSlack.map((t) => (
                  <tr key={t.title} className="border-t border-line"><td className="py-1.5 text-ink">{t.title}</td><td className="py-1.5 text-right font-data">{t.chunks}</td><td className="py-1.5 text-right font-data">{t.slackHours !== null ? `${t.slackHours}h` : t.chunks ? "no deadline" : placedElsewhere.get(titleToId.get(t.title) ?? "") ? `placed ${placedElsewhere.get(titleToId.get(t.title) ?? "")}` : "not placed"}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel>
          <h2 className="text-base font-semibold mb-1">Benchmark: solver vs naive scheduling</h2>
          {!benchmark ? (
            <p className="text-xs text-ink-soft">No benchmark results yet. Run <code className="font-data">npm run benchmark</code> to generate them.</p>
          ) : (
            <>
              <p className="text-xs text-ink-soft mb-4">
                {benchmark.weeks} randomized weeks (random commitments, sleep, energy windows, tasks with deadlines), the same inputs given to each scheduler. &ldquo;First fit&rdquo; is what a person does by hand: earliest gap wins. &ldquo;Deadline greedy&rdquo; sorts by due date first. Both avoid commitments and sleep, so the table measures judgment, not the easy part. Run {DateTime.fromISO(benchmark.ranAt).toFormat("LLL d, h:mma")}.
              </p>
              <p className="text-xs text-ink-soft mb-4">
                Read it honestly: the naive schedulers show more slack because they cram everything into the earliest hours with no daily limit, and they leave nothing unplaced for the same reason. Calendula caps how much task work lands on one day and prefers your good-energy hours, so on an overloaded week it would rather tell you something doesn&rsquo;t fit than break the cap.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead><tr className="text-left text-[10px] font-extrabold uppercase tracking-[.07em] text-ink-faint">
                    <th className="py-1">Scheduler</th><th className="py-1 text-right">Rules held</th><th className="py-1 text-right">Deadlines met</th><th className="py-1 text-right">Avg slack</th><th className="py-1 text-right">Chunks/task</th><th className="py-1 text-right">Good-energy</th><th className="py-1 text-right">Cap respected</th><th className="py-1 text-right">Unplaced</th>
                  </tr></thead>
                  <tbody>
                    {benchmark.schedulers.map((s) => (
                      <tr key={s.name} className={`border-t border-line ${s.name === "Calendula" ? "font-semibold" : ""}`}>
                        <td className="py-1.5 text-ink">{s.name}</td>
                        <td className="py-1.5 text-right font-data">{s.invariantPassRate}%</td>
                        <td className="py-1.5 text-right font-data">{s.deadlinesMetRate}%</td>
                        <td className="py-1.5 text-right font-data">{s.avgSlackHours}h</td>
                        <td className="py-1.5 text-right font-data">{s.avgChunksPerTask}</td>
                        <td className="py-1.5 text-right font-data">{s.goodEnergyRate}%</td>
                        <td className="py-1.5 text-right font-data">{s.dailyCapRate}%</td>
                        <td className="py-1.5 text-right font-data">{s.unplacedMinutesRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}

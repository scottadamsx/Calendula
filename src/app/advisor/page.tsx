import { DateTime } from "luxon";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { AddPersonForm } from "@/components/advisor/AddPersonForm";
import { LogInteractionButton } from "@/components/advisor/LogInteractionButton";
import { getAdvisorSignals } from "@/lib/scheduler/getAdvisorSignals";
import {
  formatOverloadMessage,
  formatDriftMessage,
  formatEstimateDriftMessage,
} from "@/lib/scheduler/advisorSignals";

function NotConnected({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader eyebrow="Advisor" title="What's actually going on" lead="Computed facts, not opinions — every line here traces back to a real query." />
      <Panel>
        <p className="text-sm text-ink-soft">{children}</p>
      </Panel>
    </>
  );
}

function SignalRow({ badge, tone, children }: { badge?: string; tone?: "danger" | "info" | "neutral"; children: React.ReactNode }) {
  return (
    <li className="pb-3 border-b border-line last:border-0 last:pb-0 text-sm text-ink flex items-start gap-2">
      {badge && <Badge tone={tone}>{badge}</Badge>}
      <span className="flex-1">{children}</span>
    </li>
  );
}

export default async function AdvisorPage() {
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

  const { data: peopleRows } = await supabase
    .from("calendula_people")
    .select("id, name, desired_cadence_days")
    .eq("user_id", user.id)
    .order("name");

  const signals = await getAdvisorSignals(user.id, supabase);

  const totalSignals =
    (signals.overload.length > 0 ? 1 : 0) +
    signals.relationshipDrift.length +
    signals.estimateDrift.length +
    signals.habitShortfall.length +
    signals.promotionCandidates.length +
    signals.overdueUnassigned.length;

  return (
    <>
      <PageHeader
        eyebrow="Advisor"
        title="What's actually going on"
        lead="No ANTHROPIC_API_KEY configured, so this reads as plain deterministic text rather than the spec's LLM-polished prose — the underlying signals are the real, computed facts either way; only the phrasing is the fallback."
      />

      <div className="flex flex-col gap-4">
        <AddPersonForm />

        <Panel>
          <h2 className="text-base font-semibold mb-1">Signals</h2>
          <p className="text-xs text-ink-soft mb-3">{totalSignals === 0 ? "Nothing to flag right now." : `${totalSignals} thing${totalSignals === 1 ? "" : "s"} worth knowing.`}</p>
          <ul>
            {signals.overload.length > 0 && <SignalRow>{formatOverloadMessage(signals.overload)}</SignalRow>}

            {signals.atRisk.map((a) => (
              <SignalRow key={a.taskId} badge="at risk" tone="danger">
                &ldquo;{a.title}&rdquo; has {a.slackMinutes} minutes of slack left before its deadline.
              </SignalRow>
            ))}

            {signals.habitShortfall.map((h) => (
              <SignalRow key={h.habitId} badge="habit" tone="neutral">
                {h.title} is {h.missing} session{h.missing === 1 ? "" : "s"} short this week.
              </SignalRow>
            ))}

            {signals.relationshipDrift.map((d) => (
              <SignalRow key={d.personName}>
                <div className="flex items-center justify-between gap-3">
                  <span>{formatDriftMessage(d, timezone)}</span>
                  {peopleRows?.find((p) => p.name === d.personName) && (
                    <LogInteractionButton personId={peopleRows.find((p) => p.name === d.personName)!.id} />
                  )}
                </div>
              </SignalRow>
            ))}

            {signals.estimateDrift.map((e) => (
              <SignalRow key={e.categoryId}>{formatEstimateDriftMessage(e.categoryName, e.multiplier)}</SignalRow>
            ))}

            {signals.promotionCandidates.map((p) => (
              <SignalRow key={p.reminderId} badge="promotion candidate" tone="info">
                &ldquo;{p.title}&rdquo; has come up {p.deferCount} times — probably not a quick thing.
              </SignalRow>
            ))}

            {signals.overdueUnassigned.map((r) => (
              <SignalRow key={r.reminderId} badge="overdue" tone="danger">
                &ldquo;{r.title}&rdquo; was due {DateTime.fromJSDate(r.dueAt, { zone: timezone }).toFormat("ccc LLL d")} and never surfaced.
              </SignalRow>
            ))}
          </ul>
        </Panel>

        <Panel>
          <h2 className="text-base font-semibold mb-3">People</h2>
          {(peopleRows ?? []).length === 0 ? (
            <p className="text-xs text-ink-faint">Nobody tracked yet — add someone above.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(peopleRows ?? []).map((p) => (
                <li key={p.id} className="flex items-center justify-between text-sm text-ink">
                  <span>{p.name}</span>
                  <span className="font-data text-xs text-ink-soft">
                    {p.desired_cadence_days ? `every ${p.desired_cadence_days} days` : "untracked cadence"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

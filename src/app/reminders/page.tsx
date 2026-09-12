import { DateTime } from "luxon";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { AddReminderButton } from "@/components/reminders/AddReminderButton";
import { ReminderOutcomeButtons } from "@/components/reminders/ReminderOutcomeButtons";
import { formatDigestMessage } from "@/lib/scheduler/reminders";

function NotConnected({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader eyebrow="Reminders" title="Nudges, not work" lead="Attention-budgeted reminders that only surface at a receptive moment." />
      <Panel>
        <p className="text-sm text-ink-soft">{children}</p>
      </Panel>
    </>
  );
}

const KIND_LABEL: Record<string, string> = {
  moment: "Moment",
  window: "Window",
  context: "Context",
  latent: "Someday",
};

export default async function RemindersPage() {
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

  const { data: reminders } = await supabase
    .from("calendula_reminders")
    .select("id, title, kind, due_at, window_start, window_end, importance, status, defer_count")
    .eq("user_id", user.id)
    .in("status", ["pending", "acknowledged"])
    .order("created_at", { ascending: false })
    .limit(30);

  const reminderIds = (reminders ?? []).map((r) => r.id);
  const { data: deliveries } =
    reminderIds.length > 0
      ? await supabase
          .from("calendula_reminder_deliveries")
          .select("reminder_id, scheduled_at, delivered_at, batch_id")
          .in("reminder_id", reminderIds)
          .order("scheduled_at", { ascending: true })
      : { data: [] };

  // Most recent delivery per reminder — later rows overwrite earlier ones
  // since the query above is already sorted ascending by scheduled_at.
  const latestDeliveryByReminder = new Map<
    string,
    { scheduled_at: string; delivered_at: string | null; batch_id: string | null }
  >();
  for (const d of deliveries ?? []) latestDeliveryByReminder.set(d.reminder_id, d);

  const { data: upcomingPlacements } = await supabase
    .from("calendula_placements")
    .select("title, starts_at")
    .eq("user_id", user.id)
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(3);
  const nextPlacements = (upcomingPlacements ?? []).map((p) => ({ title: p.title, start: new Date(p.starts_at) }));

  // Group reminders sharing a batch_id (spec §10.5 — "collapsed before
  // dispatch, rendered as a single digest"). Reminders array is already
  // sorted newest-first; group membership just needs a stable key.
  const groups = new Map<string, { id: string; title: string }[]>();
  const standalone: typeof reminders = [];
  for (const r of reminders ?? []) {
    const batchId = latestDeliveryByReminder.get(r.id)?.batch_id;
    if (batchId) {
      const list = groups.get(batchId) ?? [];
      list.push({ id: r.id, title: r.title });
      groups.set(batchId, list);
    } else {
      standalone.push(r);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Reminders"
        title="Nudges, not work"
        lead="Attention-budgeted — a small daily allowance of interruptions, spent only at moments that are actually receptive to one."
        action={<AddReminderButton />}
      />

      <div className="flex flex-col gap-4">

        <Panel>
          <h2 className="text-base font-semibold mb-3">Pending</h2>
          {(reminders ?? []).length === 0 ? (
            <p className="text-xs text-ink-faint">Nothing yet — use + Reminder.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {[...groups.entries()].map(([batchId, members]) => (
                <li key={batchId} className="pb-3 border-b border-line last:border-0 last:pb-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge tone="info">digest · {members.length} reminders</Badge>
                    <span className="font-data text-xs text-ink-soft">
                      {DateTime.fromISO(latestDeliveryByReminder.get(members[0].id)!.scheduled_at, {
                        zone: timezone,
                      }).toFormat("ccc h:mma")}
                    </span>
                  </div>
                  <p className="text-sm text-ink mb-2">
                    {formatDigestMessage(
                      members.map((m) => m.title),
                      nextPlacements,
                      timezone,
                    )}
                  </p>
                  <ul className="flex flex-col gap-2">
                    {members.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-3 pl-2 border-l-2 border-brand-600">
                        <span className="text-xs text-ink-soft">{m.title}</span>
                        <ReminderOutcomeButtons reminderId={m.id} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              {standalone.map((r) => {
                const delivery = latestDeliveryByReminder.get(r.id);
                const nextDelivery = delivery && !delivery.delivered_at ? delivery.scheduled_at : undefined;
                return (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 pb-3 border-b border-line last:border-0 last:pb-0"
                  >
                    <div>
                      <div className="text-sm font-medium text-ink">{r.title}</div>
                      <div className="text-xs text-ink-soft mt-0.5 flex items-center gap-2 flex-wrap">
                        <Badge tone="neutral">{KIND_LABEL[r.kind] ?? r.kind}</Badge>
                        <span className="font-data">Importance {r.importance}</span>
                        {r.due_at && (
                          <span className="font-data">
                            due {DateTime.fromISO(r.due_at, { zone: timezone }).toFormat("ccc LLL d, h:mma")}
                          </span>
                        )}
                        {r.window_start && r.window_end && (
                          <span className="font-data">
                            {DateTime.fromISO(r.window_start, { zone: timezone }).toFormat("ccc LLL d")}–
                            {DateTime.fromISO(r.window_end, { zone: timezone }).toFormat("ccc LLL d")}
                          </span>
                        )}
                        {r.defer_count > 0 && <span>deferred {r.defer_count}×</span>}
                        {r.status === "acknowledged" && <Badge tone="info">seen</Badge>}
                        {nextDelivery && (
                          <Badge tone="info">
                            surfaces {DateTime.fromISO(nextDelivery, { zone: timezone }).toFormat("ccc h:mma")}
                          </Badge>
                        )}
                        {!nextDelivery && r.kind === "latent" && <Badge tone="neutral">someday</Badge>}
                        {!nextDelivery && r.kind !== "latent" && <Badge tone="neutral">not yet scheduled</Badge>}
                      </div>
                    </div>
                    {r.kind !== "latent" && <ReminderOutcomeButtons reminderId={r.id} />}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

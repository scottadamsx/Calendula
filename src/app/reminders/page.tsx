import { DateTime } from "luxon";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { AddReminderForm } from "@/components/reminders/AddReminderForm";

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
    .in("status", ["pending", "delivered"])
    .order("created_at", { ascending: false })
    .limit(30);

  const reminderIds = (reminders ?? []).map((r) => r.id);
  const { data: deliveries } =
    reminderIds.length > 0
      ? await supabase
          .from("calendula_reminder_deliveries")
          .select("reminder_id, scheduled_at, delivered_at")
          .in("reminder_id", reminderIds)
          .is("delivered_at", null)
          .order("scheduled_at", { ascending: true })
      : { data: [] };

  const nextDeliveryByReminder = new Map<string, string>();
  for (const d of deliveries ?? []) {
    if (!nextDeliveryByReminder.has(d.reminder_id)) nextDeliveryByReminder.set(d.reminder_id, d.scheduled_at);
  }

  return (
    <>
      <PageHeader
        eyebrow="Reminders"
        title="Nudges, not work"
        lead="Attention-budgeted — a small daily allowance of interruptions, spent only at moments that are actually receptive to one."
      />

      <div className="flex flex-col gap-4">
        <AddReminderForm />

        <Panel>
          <h2 className="text-base font-semibold mb-3">Pending</h2>
          {(reminders ?? []).length === 0 ? (
            <p className="text-xs text-ink-faint">Nothing yet — add one above.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {(reminders ?? []).map((r) => {
                const nextDelivery = nextDeliveryByReminder.get(r.id);
                return (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 pb-3 border-b border-line last:border-0 last:pb-0"
                  >
                    <div>
                      <div className="text-sm font-medium text-ink">{r.title}</div>
                      <div className="text-xs text-ink-soft mt-0.5 flex items-center gap-2">
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
                      </div>
                    </div>
                    {nextDelivery ? (
                      <Badge tone="info">
                        surfaces {DateTime.fromISO(nextDelivery, { zone: timezone }).toFormat("ccc h:mma")}
                      </Badge>
                    ) : r.kind === "latent" ? (
                      <Badge tone="neutral">someday</Badge>
                    ) : (
                      <Badge tone="neutral">not yet scheduled</Badge>
                    )}
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

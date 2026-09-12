"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { deleteCalendarItem, type DeletableKind } from "@/app/actions/deleteItems";

export interface EventCardProps {
  sourceId: string;
  sourceType: string;
  title: string;
  startIso: string;
  endIso: string;
  state: "hard" | "soft";
  location?: string;
  timezone: string;
  layout?: "list" | "grid";
}

const KIND: Record<string, { label: string; deletable: DeletableKind | null; warning: string }> = {
  fixed: { label: "Commitment", deletable: "fixed_block", warning: "Deletes this commitment and every repeat of it. Everything scheduled around it gets re-solved." },
  task: { label: "Task", deletable: "task", warning: "Deletes the whole task, including any other chunks of it on other days." },
  habit: { label: "Habit", deletable: "habit", warning: "Deletes the habit itself — every session this week and every week after." },
  activity_hold: { label: "Held for a plan", deletable: null, warning: "Release it from the Planning page." },
  meeting_hold: { label: "Tentative meeting", deletable: null, warning: "Managed from the Meetings page." },
  meeting: { label: "Meeting", deletable: null, warning: "Managed from the Meetings page." },
};

/** Spec §14.4 state encoding: solid dark = hard, Ray edge = task, Leaf edge = habit. */
function styleFor(sourceType: string, state: "hard" | "soft") {
  if (state === "hard") return { container: "rounded-sm bg-ink text-paper px-2.5 py-1.5 hover:bg-ink/90", title: "text-paper", meta: "text-paper/75" };
  if (sourceType === "habit") return { container: "border-l-2 border-accent-habit bg-accent-habit/10 pl-2.5 pr-2 py-1.5 rounded-r-sm hover:bg-accent-habit/20", title: "text-ink", meta: "text-ink-soft" };
  return { container: "border-l-2 border-brand-600 bg-brand-50 pl-2.5 pr-2 py-1.5 rounded-r-sm hover:bg-brand-100", title: "text-ink", meta: "text-ink-soft" };
}

export function EventCard(p: EventCardProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const style = styleFor(p.sourceType, p.state);
  const kind = KIND[p.sourceType] ?? { label: p.sourceType, deletable: null, warning: "" };
  const start = DateTime.fromISO(p.startIso, { zone: p.timezone });
  const end = DateTime.fromISO(p.endIso, { zone: p.timezone });

  function remove() {
    if (!kind.deletable) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteCalendarItem(kind.deletable!, p.sourceId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`${p.title}, ${start.toFormat("h:mm")}–${end.toFormat("h:mm a")}`}
        className={`w-full text-left transition-colors duration-150 ${style.container} ${p.layout === "grid" ? "h-full overflow-hidden !py-1 !px-2 flex flex-col" : ""}`}
      >
        <div className={`text-xs font-semibold leading-snug ${style.title} ${p.layout === "grid" ? "truncate" : ""}`}>{p.title}</div>
        <div className={`font-data text-[11px] ${style.meta} ${p.layout === "grid" ? "truncate" : ""}`}>
          {start.toFormat("h:mm")}–{end.toFormat("h:mm a")}
        </div>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={p.title}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm mb-5">
          <dt className="text-ink-soft">Kind</dt>
          <dd><Badge tone={p.state === "hard" ? "neutral" : p.sourceType === "habit" ? "success" : "info"}>{kind.label}</Badge></dd>
          <dt className="text-ink-soft">When</dt>
          <dd className="font-data">{start.toFormat("ccc LLL d, h:mm a")} – {end.toFormat("h:mm a")}</dd>
          {p.location && (
            <>
              <dt className="text-ink-soft">Where</dt>
              <dd>{p.location}</dd>
            </>
          )}
        </dl>
        <p className="text-xs text-ink-faint mb-4 max-w-[52ch]">{kind.warning}</p>
        {error && <p className="text-xs text-danger mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="quiet" size="md" onClick={() => setOpen(false)}>Close</Button>
          {kind.deletable && (
            <Button variant="danger" size="md" disabled={isPending} onClick={remove}>
              {isPending ? "Deleting…" : "Delete"}
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}

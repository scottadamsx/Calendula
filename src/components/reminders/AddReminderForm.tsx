"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { createReminder, type CreateReminderResult } from "@/app/actions/reminders";

const initialState: CreateReminderResult | null = null;

const inputClass =
  "h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none";

export function AddReminderForm() {
  const [state, formAction, isPending] = useActionState(createReminder, initialState);
  const [kind, setKind] = useState<"moment" | "window" | "latent">("moment");

  return (
    <Panel>
      <h2 className="text-base font-semibold mb-1">Add a reminder</h2>
      <p className="text-xs text-ink-soft mb-3">
        A nudge, not work — reminders ride on top of your schedule and only surface at a receptive
        moment, never during sleep or something already pinned down.
      </p>
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
          <span className="text-xs font-medium text-ink-soft">Title</span>
          <input type="text" name="title" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 w-[130px]">
          <span className="text-xs font-medium text-ink-soft">Kind</span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className={inputClass}
          >
            <option value="moment">Moment</option>
            <option value="window">Window</option>
            <option value="latent">Someday</option>
          </select>
        </label>
        {kind === "moment" && (
          <label className="flex flex-col gap-1 w-[200px]">
            <span className="text-xs font-medium text-ink-soft">Due</span>
            <input type="datetime-local" name="dueAt" required className={`font-data ${inputClass}`} />
          </label>
        )}
        {kind === "window" && (
          <>
            <label className="flex flex-col gap-1 w-[200px]">
              <span className="text-xs font-medium text-ink-soft">Window start</span>
              <input type="datetime-local" name="windowStart" required className={`font-data ${inputClass}`} />
            </label>
            <label className="flex flex-col gap-1 w-[200px]">
              <span className="text-xs font-medium text-ink-soft">Window end</span>
              <input type="datetime-local" name="windowEnd" required className={`font-data ${inputClass}`} />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 w-[110px]">
          <span className="text-xs font-medium text-ink-soft">Importance</span>
          <select name="importance" defaultValue="3" className={`font-data ${inputClass}`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="md" disabled={isPending}>
          {isPending ? "Saving…" : "Add reminder"}
        </Button>
      </form>
      {state && (
        <p className={`text-xs mt-2 ${state.ok ? "text-accent-reminder" : "text-danger"}`}>{state.message}</p>
      )}
    </Panel>
  );
}

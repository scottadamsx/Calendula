"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { createActivityType, type CreateActivityTypeResult } from "@/app/actions/activityHolds";

const initialState: CreateActivityTypeResult | null = null;
const inputClass = "h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none";

export function AddActivityTypeForm() {
  const [state, formAction, isPending] = useActionState(createActivityType, initialState);

  return (
    <Panel>
      <h2 className="text-base font-semibold mb-1">Add an activity type</h2>
      <p className="text-xs text-ink-soft mb-3">
        A category of thing worth defending time for — camping, a course, a trip — searched for
        good windows below.
      </p>
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <span className="text-xs font-medium text-ink-soft">Name</span>
          <input type="text" name="name" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 w-[130px]">
          <span className="text-xs font-medium text-ink-soft">Min duration (hrs)</span>
          <input type="number" name="minDurationHours" min={1} step={1} required defaultValue={48} className={`font-data ${inputClass}`} />
        </label>
        <label className="flex flex-col gap-1 w-[110px]">
          <span className="text-xs font-medium text-ink-soft">Lead time (days)</span>
          <input type="number" name="leadTimeDays" min={0} step={1} defaultValue={14} className={`font-data ${inputClass}`} />
        </label>
        <label className="flex flex-col gap-1 w-[130px]">
          <span className="text-xs font-medium text-ink-soft">Recovery after (hrs)</span>
          <input type="number" name="bufferAfterHours" min={0} step={1} defaultValue={24} className={`font-data ${inputClass}`} />
        </label>
        <label className="flex flex-col gap-1 w-[130px]">
          <span className="text-xs font-medium text-ink-soft">Season start (optional)</span>
          <input type="date" name="seasonStart" className={`font-data ${inputClass}`} />
        </label>
        <label className="flex flex-col gap-1 w-[130px]">
          <span className="text-xs font-medium text-ink-soft">Season end (optional)</span>
          <input type="date" name="seasonEnd" className={`font-data ${inputClass}`} />
        </label>
        <label className="flex items-center gap-2 h-10">
          <input type="checkbox" name="requiresOvernight" className="h-4 w-4" />
          <span className="text-xs font-medium text-ink-soft">Requires overnight</span>
        </label>
        <label className="flex items-center gap-2 h-10">
          <input type="checkbox" name="weatherSensitive" className="h-4 w-4" />
          <span className="text-xs font-medium text-ink-soft">Weather sensitive</span>
        </label>
        <Button type="submit" size="md" disabled={isPending}>
          {isPending ? "Adding…" : "Add"}
        </Button>
      </form>
      {state && <p className={`text-xs mt-2 ${state.ok ? "text-accent-habit" : "text-danger"}`}>{state.message}</p>}
    </Panel>
  );
}

"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { createHabit, type CreateHabitResult } from "@/app/actions/habits";

const initialState: CreateHabitResult | null = null;

export function AddHabitForm() {
  const [state, formAction, isPending] = useActionState(createHabit, initialState);

  return (
    <Panel>
      <h2 className="text-base font-semibold mb-1">Add a habit</h2>
      <p className="text-xs text-ink-soft mb-3">
        Recurring, spaced apart automatically — Leaf-colored blocks below are habit sessions,
        distinct from tasks (Ray) and fixed commitments (solid dark).
      </p>
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <span className="text-xs font-medium text-ink-soft">Title</span>
          <input
            type="text"
            name="title"
            required
            className="h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 w-[130px]">
          <span className="text-xs font-medium text-ink-soft">Duration (min)</span>
          <input
            type="number"
            name="durationMinutes"
            min={5}
            step={5}
            required
            defaultValue={60}
            className="font-data h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 w-[110px]">
          <span className="text-xs font-medium text-ink-soft">Times/week</span>
          <input
            type="number"
            name="targetSessionsPerWeek"
            min={1}
            max={7}
            required
            defaultValue={3}
            className="font-data h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 w-[130px]">
          <span className="text-xs font-medium text-ink-soft">Min spacing (hrs)</span>
          <input
            type="number"
            name="minSpacingHours"
            min={0}
            required
            defaultValue={24}
            className="font-data h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 w-[110px]">
          <span className="text-xs font-medium text-ink-soft">Earliest</span>
          <input
            type="time"
            name="earliestTime"
            className="font-data h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 w-[110px]">
          <span className="text-xs font-medium text-ink-soft">Latest</span>
          <input
            type="time"
            name="latestTime"
            className="font-data h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          />
        </label>
        <Button type="submit" size="md" disabled={isPending}>
          {isPending ? "Scheduling…" : "Add habit"}
        </Button>
      </form>
      {state && (
        <p className={`text-xs mt-2 ${state.ok ? "text-accent-habit" : "text-danger"}`}>{state.message}</p>
      )}
    </Panel>
  );
}

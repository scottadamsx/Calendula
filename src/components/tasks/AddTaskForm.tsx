"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { createTask, type CreateTaskResult } from "@/app/actions/tasks";

const initialState: CreateTaskResult | null = null;

export function AddTaskForm() {
  const [state, formAction, isPending] = useActionState(createTask, initialState);

  return (
    <Panel>
      <h2 className="text-base font-semibold mb-1">Add a task</h2>
      <p className="text-xs text-ink-soft mb-3">
        Give it a deadline and it schedules itself — Ray-colored blocks below are what the
        solver placed, distinct from the solid dark fixed commitments.
      </p>
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
          <span className="text-xs font-medium text-ink-soft">Title</span>
          <input
            type="text"
            name="title"
            required
            className="h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 w-[140px]">
          <span className="text-xs font-medium text-ink-soft">Duration (minutes)</span>
          <input
            type="number"
            name="estimatedMinutes"
            min={5}
            step={5}
            required
            defaultValue={60}
            className="font-data h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 w-[200px]">
          <span className="text-xs font-medium text-ink-soft">Deadline</span>
          <input
            type="datetime-local"
            name="deadline"
            className="font-data h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 w-[110px]">
          <span className="text-xs font-medium text-ink-soft">Priority</span>
          <select
            name="priority"
            defaultValue={3}
            className="h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          >
            {[1, 2, 3, 4, 5].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="md" disabled={isPending}>
          {isPending ? "Scheduling…" : "Add task"}
        </Button>
      </form>
      {state && (
        <p className={`text-xs mt-2 ${state.ok ? "text-accent-habit" : "text-danger"}`}>{state.message}</p>
      )}
    </Panel>
  );
}

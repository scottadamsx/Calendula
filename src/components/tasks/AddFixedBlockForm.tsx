"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { createFixedBlock, type CreateFixedBlockResult } from "@/app/actions/fixedBlocks";

const initialState: CreateFixedBlockResult | null = null;

export function AddFixedBlockForm() {
  const [state, formAction, isPending] = useActionState(createFixedBlock, initialState);

  return (
    <Panel>
      <h2 className="text-base font-semibold mb-1">Add a fixed commitment</h2>
      <p className="text-xs text-ink-soft mb-3">
        A class, shift, or appointment — never moved by the solver. Solid dark blocks below.
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
        <label className="flex flex-col gap-1 w-[200px]">
          <span className="text-xs font-medium text-ink-soft">Starts</span>
          <input
            type="datetime-local"
            name="startsAt"
            required
            className="font-data h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 w-[200px]">
          <span className="text-xs font-medium text-ink-soft">Ends</span>
          <input
            type="datetime-local"
            name="endsAt"
            required
            className="font-data h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 w-[150px]">
          <span className="text-xs font-medium text-ink-soft">Location (optional)</span>
          <input
            type="text"
            name="location"
            className="h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          />
        </label>
        <label className="flex items-center gap-2 h-10">
          <input type="checkbox" name="repeatsWeekly" className="h-4 w-4" />
          <span className="text-xs font-medium text-ink-soft">Repeats weekly</span>
        </label>
        <Button type="submit" size="md" disabled={isPending}>
          {isPending ? "Adding…" : "Add"}
        </Button>
      </form>
      {state && (
        <p className={`text-xs mt-2 ${state.ok ? "text-accent-habit" : "text-danger"}`}>{state.message}</p>
      )}
    </Panel>
  );
}

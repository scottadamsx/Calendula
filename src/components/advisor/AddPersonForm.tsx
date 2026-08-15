"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { createPerson, type CreatePersonResult } from "@/app/actions/people";

const initialState: CreatePersonResult | null = null;
const inputClass = "h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none";

export function AddPersonForm() {
  const [state, formAction, isPending] = useActionState(createPerson, initialState);

  return (
    <Panel>
      <h2 className="text-base font-semibold mb-1">Add a person</h2>
      <p className="text-xs text-ink-soft mb-3">
        Set how often you want to keep up with them — leave it blank to track someone without any
        cadence pressure.
      </p>
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <span className="text-xs font-medium text-ink-soft">Name</span>
          <input type="text" name="name" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 w-[160px]">
          <span className="text-xs font-medium text-ink-soft">Desired cadence (days)</span>
          <input type="number" name="desiredCadenceDays" min={1} step={1} placeholder="optional" className={`font-data ${inputClass}`} />
        </label>
        <Button type="submit" size="md" disabled={isPending}>
          {isPending ? "Adding…" : "Add"}
        </Button>
      </form>
      {state && <p className={`text-xs mt-2 ${state.ok ? "text-accent-habit" : "text-danger"}`}>{state.message}</p>}
    </Panel>
  );
}

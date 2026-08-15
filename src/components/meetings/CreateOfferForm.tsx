"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { createMeetingOffer, type CreateOfferResult } from "@/app/actions/meetings";

const initialState: CreateOfferResult | null = null;

export function CreateOfferForm() {
  const [state, formAction, isPending] = useActionState(createMeetingOffer, initialState);

  return (
    <Panel>
      <h2 className="text-base font-semibold mb-1">Find a time</h2>
      <p className="text-xs text-ink-soft mb-3">
        Finds real slots that won&rsquo;t double-book you and holds them tentatively until one is
        confirmed — nothing else can fill them in the meantime.
      </p>
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <span className="text-xs font-medium text-ink-soft">Purpose (optional)</span>
          <input
            type="text"
            name="purpose"
            placeholder="Coffee?"
            className="h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 w-[130px]">
          <span className="text-xs font-medium text-ink-soft">Type</span>
          <select
            name="meetingType"
            defaultValue="work"
            className="h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          >
            <option value="social">Social</option>
            <option value="work">Work</option>
            <option value="call">Call</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 w-[130px]">
          <span className="text-xs font-medium text-ink-soft">Duration (min)</span>
          <input
            type="number"
            name="durationMinutes"
            min={15}
            step={15}
            required
            defaultValue={60}
            className="font-data h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 w-[130px]">
          <span className="text-xs font-medium text-ink-soft">Within (days)</span>
          <input
            type="number"
            name="horizonDays"
            min={1}
            max={14}
            required
            defaultValue={7}
            className="font-data h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          />
        </label>
        <Button type="submit" size="md" disabled={isPending}>
          {isPending ? "Searching…" : "Find times"}
        </Button>
      </form>
      {state && (
        <div className="mt-3 p-3 rounded-sm bg-brand-50">
          <p className={`text-sm ${state.ok ? "text-ink" : "text-danger"}`}>{state.message}</p>
        </div>
      )}
    </Panel>
  );
}

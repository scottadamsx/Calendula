"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { createFixedBlock, type CreateFixedBlockResult } from "@/app/actions/fixedBlocks";

const initialState: CreateFixedBlockResult | null = null;

const WEEKDAYS = [
  { code: "MO", label: "Mon" },
  { code: "TU", label: "Tue" },
  { code: "WE", label: "Wed" },
  { code: "TH", label: "Thu" },
  { code: "FR", label: "Fri" },
  { code: "SA", label: "Sat" },
  { code: "SU", label: "Sun" },
] as const;

export function AddFixedBlockForm({ onSuccess }: { onSuccess?: (message: string) => void }) {
  const [state, formAction, isPending] = useActionState(createFixedBlock, initialState);
  useEffect(() => {
    if (state?.ok) onSuccess?.(state.message);
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="What is it">
        <input type="text" name="title" required autoFocus placeholder="Work, CP4485 lecture, dentist…" className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Starts">
          <input type="datetime-local" name="startsAt" required className={`font-data ${inputClass}`} />
        </Field>
        <Field label="Ends">
          <input type="datetime-local" name="endsAt" required className={`font-data ${inputClass}`} />
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-ink-soft">Repeats every week on</span>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => (
            <label key={day.code} className="cursor-pointer">
              <input type="checkbox" name="repeatsOnDays" value={day.code} className="peer sr-only" />
              <span className="inline-flex h-8 items-center rounded-full border border-line px-3 text-xs font-semibold text-ink-soft peer-checked:border-brand-400 peer-checked:bg-brand-50 peer-checked:text-brand-700 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand-400">
                {day.label}
              </span>
            </label>
          ))}
        </div>
        <span className="text-xs text-ink-faint">Leave them all off for a one-time thing.</span>
      </div>
      <Field label="Location (optional)">
        <input type="text" name="location" className={inputClass} />
      </Field>
      {state && !state.ok && <p className="text-xs text-danger">{state.message}</p>}
      <div className="flex justify-end pt-2">
        <Button type="submit" size="md" disabled={isPending}>
          {isPending ? "Adding…" : "Add commitment"}
        </Button>
      </div>
    </form>
  );
}

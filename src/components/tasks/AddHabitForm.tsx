"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { createHabit, type CreateHabitResult } from "@/app/actions/habits";

const initialState: CreateHabitResult | null = null;

export function AddHabitForm({ onSuccess }: { onSuccess?: (message: string) => void }) {
  const [state, formAction, isPending] = useActionState(createHabit, initialState);
  useEffect(() => {
    if (state?.ok) onSuccess?.(state.message);
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Habit">
        <input type="text" name="title" required autoFocus className={inputClass} />
      </Field>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Minutes each">
          <input type="number" name="durationMinutes" min={5} step={5} required defaultValue={60} className={`font-data ${inputClass}`} />
        </Field>
        <Field label="Times a week">
          <input type="number" name="targetSessionsPerWeek" min={1} max={7} required defaultValue={3} className={`font-data ${inputClass}`} />
        </Field>
        <Field label="Hours apart">
          <input type="number" name="minSpacingHours" min={0} required defaultValue={24} className={`font-data ${inputClass}`} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Earliest start (optional)">
          <input type="time" name="earliestTime" className={`font-data ${inputClass}`} />
        </Field>
        <Field label="Latest finish (optional)">
          <input type="time" name="latestTime" className={`font-data ${inputClass}`} />
        </Field>
      </div>
      {state && !state.ok && <p className="text-xs text-danger">{state.message}</p>}
      <div className="flex justify-end pt-2">
        <Button type="submit" size="md" disabled={isPending}>
          {isPending ? "Scheduling…" : "Add habit"}
        </Button>
      </div>
    </form>
  );
}

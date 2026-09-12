"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { createTask, type CreateTaskResult } from "@/app/actions/tasks";

const initialState: CreateTaskResult | null = null;

export function AddTaskForm({ onSuccess }: { onSuccess?: (message: string) => void }) {
  const [state, formAction, isPending] = useActionState(createTask, initialState);
  useEffect(() => {
    if (state?.ok) onSuccess?.(state.message);
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="What needs doing">
        <input type="text" name="title" required autoFocus className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="How long (minutes)">
          <input type="number" name="estimatedMinutes" min={5} step={5} required defaultValue={60} className={`font-data ${inputClass}`} />
        </Field>
        <Field label="Priority (1 low – 5 high)">
          <select name="priority" defaultValue={3} className={inputClass}>
            {[1, 2, 3, 4, 5].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Deadline (optional)">
        <input type="datetime-local" name="deadline" className={`font-data ${inputClass}`} />
      </Field>
      {state && !state.ok && <p className="text-xs text-danger">{state.message}</p>}
      <div className="flex justify-end pt-2">
        <Button type="submit" size="md" disabled={isPending}>
          {isPending ? "Scheduling…" : "Add task"}
        </Button>
      </div>
    </form>
  );
}

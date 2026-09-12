"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { createReminder, type CreateReminderResult } from "@/app/actions/reminders";

const initialState: CreateReminderResult | null = null;

export function AddReminderForm({ onSuccess }: { onSuccess?: (message: string) => void }) {
  const [state, formAction, isPending] = useActionState(createReminder, initialState);
  const [kind, setKind] = useState<"moment" | "window" | "latent">("moment");
  useEffect(() => {
    if (state?.ok) onSuccess?.(state.message);
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Remind me to">
        <input type="text" name="title" required autoFocus className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="When">
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={inputClass}>
            <option value="moment">By a specific time</option>
            <option value="window">Sometime in a range</option>
            <option value="latent">Someday, no rush</option>
          </select>
        </Field>
        <Field label="Importance (1–5)">
          <select name="importance" defaultValue="3" className={`font-data ${inputClass}`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </Field>
      </div>
      {kind === "moment" && (
        <Field label="Due by">
          <input type="datetime-local" name="dueAt" required className={`font-data ${inputClass}`} />
        </Field>
      )}
      {kind === "window" && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Not before">
            <input type="datetime-local" name="windowStart" required className={`font-data ${inputClass}`} />
          </Field>
          <Field label="Not after">
            <input type="datetime-local" name="windowEnd" required className={`font-data ${inputClass}`} />
          </Field>
        </div>
      )}
      {state && !state.ok && <p className="text-xs text-danger">{state.message}</p>}
      <div className="flex justify-end pt-2">
        <Button type="submit" size="md" disabled={isPending}>
          {isPending ? "Saving…" : "Add reminder"}
        </Button>
      </div>
    </form>
  );
}

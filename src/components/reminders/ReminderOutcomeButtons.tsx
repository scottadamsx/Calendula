"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { recordReminderOutcome, type ReminderOutcome } from "@/app/actions/reminders";

const OUTCOMES: { outcome: ReminderOutcome; label: string; variant: "secondary" | "quiet" | "ghost" }[] = [
  { outcome: "done", label: "Done", variant: "secondary" },
  { outcome: "acknowledged", label: "Seen", variant: "quiet" },
  { outcome: "deferred", label: "Later", variant: "quiet" },
  { outcome: "dismissed", label: "Dismiss", variant: "ghost" },
];

export function ReminderOutcomeButtons({ reminderId }: { reminderId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingOutcome, setPendingOutcome] = useState<ReminderOutcome | null>(null);

  return (
    <div className="flex flex-col gap-1 items-end">
      <div className="flex items-center gap-1">
        {OUTCOMES.map(({ outcome, label, variant }) => (
          <Button
            key={outcome}
            variant={variant}
            size="sm"
            disabled={isPending}
            onClick={() => {
              setError(null);
              setPendingOutcome(outcome);
              startTransition(async () => {
                const result = await recordReminderOutcome(reminderId, outcome);
                if (!result.ok) setError(result.message);
              });
            }}
          >
            {isPending && pendingOutcome === outcome ? "…" : label}
          </Button>
        ))}
      </div>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

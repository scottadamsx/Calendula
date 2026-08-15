"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { logCompletion } from "@/app/actions/completions";

export function CheckInButtons({ placementId, plannedMinutes }: { placementId: string; plannedMinutes: number }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [showActualForm, setShowActualForm] = useState(false);
  const [actualMinutes, setActualMinutes] = useState(String(plannedMinutes));

  if (message) {
    return <span className="text-xs text-ink-soft">{message}</span>;
  }

  return (
    <div className="flex flex-col gap-1 items-end">
      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await logCompletion(placementId, true, null);
              setMessage(result.message);
            })
          }
        >
          As planned
        </Button>
        <Button variant="quiet" size="sm" disabled={isPending} onClick={() => setShowActualForm((v) => !v)}>
          Different…
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await logCompletion(placementId, false, null);
              setMessage(result.message);
            })
          }
        >
          Skipped
        </Button>
      </div>
      {showActualForm && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={actualMinutes}
            onChange={(e) => setActualMinutes(e.target.value)}
            className="font-data h-8 w-20 px-2 text-xs rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
          />
          <span className="text-xs text-ink-soft">min, done</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await logCompletion(placementId, true, Number(actualMinutes) || 0);
                setMessage(result.message);
              })
            }
          >
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

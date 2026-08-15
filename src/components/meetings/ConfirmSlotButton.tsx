"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { confirmMeetingOffer } from "@/app/actions/meetings";

export function ConfirmSlotButton({ offerId, slotId }: { offerId: string; slotId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1 items-end">
      <Button
        variant="secondary"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await confirmMeetingOffer(offerId, slotId);
            if (!result.ok) setError(result.message);
          })
        }
      >
        {isPending ? "Confirming…" : "Confirm this one"}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

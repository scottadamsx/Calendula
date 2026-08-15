"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { releaseActivityHold } from "@/app/actions/activityHolds";

export function ReleaseHoldButton({ holdId }: { holdId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1 items-end">
      <Button
        variant="ghost"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await releaseActivityHold(holdId);
            if (!result.ok) setError(result.message);
          })
        }
      >
        {isPending ? "Releasing…" : "Release"}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

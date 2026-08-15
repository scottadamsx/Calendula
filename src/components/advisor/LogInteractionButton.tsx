"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { logInteraction } from "@/app/actions/people";

export function LogInteractionButton({ personId }: { personId: string }) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  if (done) return <span className="text-xs text-ink-soft">Logged</span>;

  return (
    <Button
      variant="quiet"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await logInteraction(personId);
          setDone(true);
        })
      }
    >
      {isPending ? "Logging…" : "We talked today"}
    </Button>
  );
}

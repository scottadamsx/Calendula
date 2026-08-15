"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { acceptDemotion, declineDemotion } from "@/app/actions/demotions";

export function DemotionProposalButtons({ taskId }: { taskId: string }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (message) return <span className="text-xs text-ink-soft">{message}</span>;

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="secondary"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await acceptDemotion(taskId);
            setMessage(result.message);
          })
        }
      >
        Make it a reminder
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await declineDemotion(taskId);
            setMessage(result.message);
          })
        }
      >
        Keep as a task
      </Button>
    </div>
  );
}

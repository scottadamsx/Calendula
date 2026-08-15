"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { acceptPromotion, declinePromotion } from "@/app/actions/promotions";

export function PromotionProposalButtons({ reminderId }: { reminderId: string }) {
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
            const result = await acceptPromotion(reminderId);
            setMessage(result.message);
          })
        }
      >
        Schedule it
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await declinePromotion(reminderId);
            setMessage(result.message);
          })
        }
      >
        No thanks
      </Button>
    </div>
  );
}

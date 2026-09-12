"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { AddReminderForm } from "@/components/reminders/AddReminderForm";

export function AddReminderButton() {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const done = useCallback((message: string) => {
    setOpen(false);
    setNotice(message);
  }, []);
  return (
    <>
      <div className="flex flex-col items-end gap-2">
        <Button size="sm" onClick={() => setOpen(true)}>+ Reminder</Button>
        {notice && <span role="status" className="text-xs text-ink-soft max-w-[40ch] text-right">{notice}</span>}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a reminder" description="A nudge, not work. It surfaces at a receptive moment — never during sleep or something already pinned down.">
        <AddReminderForm onSuccess={done} />
      </Modal>
    </>
  );
}

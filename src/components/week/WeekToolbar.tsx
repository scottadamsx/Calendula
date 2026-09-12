"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { AddFixedBlockForm } from "@/components/tasks/AddFixedBlockForm";
import { AddTaskForm } from "@/components/tasks/AddTaskForm";
import { AddHabitForm } from "@/components/tasks/AddHabitForm";

type Which = "commitment" | "task" | "habit" | null;

const COPY: Record<Exclude<Which, null>, { title: string; description: string }> = {
  commitment: {
    title: "Add a commitment",
    description: "A class, shift, or appointment. It never moves — everything else schedules around it.",
  },
  task: {
    title: "Add a task",
    description: "Work that needs to get done. Give it a length and a deadline; the scheduler finds the time and moves it as things change.",
  },
  habit: {
    title: "Add a habit",
    description: "Something you do a few times a week. Sessions get spaced out automatically.",
  },
};

export function WeekToolbar() {
  const [open, setOpen] = useState<Which>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const done = useCallback((message: string) => {
    setOpen(null);
    setNotice(message);
  }, []);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setOpen("commitment")}>+ Commitment</Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen("task")}>+ Task</Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen("habit")}>+ Habit</Button>
      </div>

      {notice && (
        <div role="status" className="mt-3 flex items-start justify-between gap-3 rounded-sm border border-line bg-surface px-3 py-2 text-xs text-ink">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-ink-faint hover:text-ink" aria-label="Dismiss">×</button>
        </div>
      )}

      <Modal open={open === "commitment"} onClose={() => setOpen(null)} title={COPY.commitment.title} description={COPY.commitment.description}>
        <AddFixedBlockForm onSuccess={done} />
      </Modal>
      <Modal open={open === "task"} onClose={() => setOpen(null)} title={COPY.task.title} description={COPY.task.description}>
        <AddTaskForm onSuccess={done} />
      </Modal>
      <Modal open={open === "habit"} onClose={() => setOpen(null)} title={COPY.habit.title} description={COPY.habit.description}>
        <AddHabitForm onSuccess={done} />
      </Modal>
    </>
  );
}

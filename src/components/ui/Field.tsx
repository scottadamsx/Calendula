import type { ReactNode } from "react";

export const inputClass =
  "h-10 w-full px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none";

/** Label-over-control, the one form field layout (housestyle-ui.md §4). */
export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

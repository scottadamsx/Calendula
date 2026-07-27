import type { HTMLAttributes } from "react";

/** The default card: flat elevation, border first (housestyle-ui.md §7). */
export function Panel({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-surface border border-line rounded-lg p-5 md:p-5 ${className}`}
      {...props}
    />
  );
}

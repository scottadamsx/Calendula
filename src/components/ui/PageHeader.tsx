import type { ReactNode } from "react";

/** The standard page-title block (housestyle-ui.md §10): every page has one. */
export function PageHeader({
  eyebrow,
  title,
  lead,
  action,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-8">
      <div>
        <div className="text-[10px] font-extrabold uppercase tracking-[.07em] text-brand-700 mb-2">
          {eyebrow}
        </div>
        <h1 className="font-display text-xl md:text-[26px] font-bold tracking-[-0.02em] text-ink">
          {title}
        </h1>
        {lead && <p className="mt-2 text-sm text-ink-soft max-w-[60ch]">{lead}</p>}
      </div>
      {action}
    </div>
  );
}

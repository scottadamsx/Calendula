"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The modal elevation level (housestyle-ui.md §7): native <dialog> so Escape,
 * focus containment, and the backdrop come from the platform, not a
 * re-implementation. Becomes a bottom sheet under 620px (§11 breakpoints) —
 * see `dialog.calendula-modal` in globals.css. Children unmount when closed
 * so a form inside always opens fresh.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="calendula-modal m-auto w-[min(560px,calc(100vw-32px))] max-h-[calc(100dvh-32px)] overflow-auto rounded-lg border border-line bg-surface p-0 text-ink"
    >
      {open && (
        <div className="p-6 md:p-8">
          <div className="flex items-start justify-between gap-4 mb-1">
            <h2 className="font-display text-xl font-bold tracking-[-0.02em] text-ink">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="h-8 w-8 -mr-2 -mt-1 inline-flex items-center justify-center rounded-full text-ink-soft hover:bg-brand-50 hover:text-ink"
            >
              ×
            </button>
          </div>
          {description && <p className="text-sm text-ink-soft mb-5 max-w-[52ch]">{description}</p>}
          {!description && <div className="mb-5" />}
          {children}
        </div>
      )}
    </dialog>
  );
}

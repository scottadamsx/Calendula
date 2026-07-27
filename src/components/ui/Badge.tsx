import type { ReactNode } from "react";

/**
 * Semantic status pairs (housestyle-ui.md §1): a tint background plus a dark
 * text of the same hue, never a saturated fill. Declared once, never
 * assembled inline.
 */
type Tone = "success" | "info" | "warn" | "danger" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-accent-habit/15 text-accent-habit",
  info: "bg-brand-50 text-brand-700",
  warn: "bg-accent-reminder/20 text-ink",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-line/60 text-ink-soft",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center h-6 px-2.5 rounded-full text-xs font-semibold ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

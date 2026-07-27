import { type ButtonHTMLAttributes, forwardRef } from "react";

/**
 * The closed button set (housestyle-ui.md §6). A sixth variant needs a
 * documented decision. Height is set explicitly per size, never derived
 * from padding (§4) — the ramp is the whole reason this component exists
 * instead of one-off className strings.
 */

type Variant = "primary" | "secondary" | "quiet" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-700",
  secondary:
    "bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100 active:bg-brand-100",
  quiet: "bg-surface text-ink-soft border border-line hover:bg-brand-50 active:bg-brand-50",
  ghost: "bg-transparent text-brand-600 hover:text-brand-700 active:text-brand-700",
  danger: "bg-danger text-white hover:bg-danger-dark active:bg-danger-dark",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className = "", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={[
        "inline-flex items-center justify-center rounded-sm font-semibold transition-[background-color,color,border-color] duration-150 ease-out",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ].join(" ")}
      {...props}
    />
  );
});

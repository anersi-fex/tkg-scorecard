"use client";

import { cn } from "@/components/ui";

/** An iPhone-style switch: the cobalt-to-violet gradient when on, the track color when off. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Read by screen readers; the visible label sits beside the switch. */
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full p-[2px] transition-colors duration-200 disabled:opacity-50",
        checked ? "bg-tide-strong" : "bg-gray-300",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-[27px] w-[27px] rounded-full bg-segment shadow-card transition-transform duration-200",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

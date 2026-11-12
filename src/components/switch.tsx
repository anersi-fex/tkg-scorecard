"use client";

import { cn } from "@/components/ui";

/** An on/off switch (the demo's): the accent when on with a white thumb, a quiet track and thumb when off. */
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
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full p-[3px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-accent" : "bg-line-2",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-[18px] w-[18px] rounded-full transition-[transform,background-color] duration-150",
          checked ? "translate-x-4 bg-on-grad" : "translate-x-0 bg-fg-2",
        )}
      />
    </button>
  );
}

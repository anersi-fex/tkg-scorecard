"use client";

import type { ReactNode } from "react";
import { cn } from "@/components/ui";
import { Icon, type IconName } from "@/components/ui/icon";

/**
 * The segmented control with buttons (the demo's .seg): a track, the picked one a pill in the page
 * color, the rest in the secondary text color. For links that change the address use
 * SegmentedLinks in kit.tsx. role="radiogroup" so a screen reader says which one is on.
 */
export function Segmented<K extends string>({
  items,
  value,
  onChange,
  label,
  small,
  full,
  className,
}: {
  items: Array<{ key: K; label: ReactNode; icon?: IconName; title?: string; disabled?: boolean }>;
  value: K;
  onChange: (key: K) => void;
  /** aria-label for the group */
  label: string;
  small?: boolean;
  /** Stretch to the full width, every segment the same size. */
  full?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("seg", small && "seg-sm", full && "seg-full", className)}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role="radio"
            aria-checked={on}
            title={it.title}
            disabled={it.disabled}
            className={cn("seg-btn", on && "on")}
            onClick={() => !on && onChange(it.key)}
          >
            {it.icon && <Icon name={it.icon} size={16} />}
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

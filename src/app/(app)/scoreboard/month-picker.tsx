"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";

/** "This month" and the earlier months that have sales; picking one goes to its address. */
export function MonthPicker({ value, options, label = "Month" }: { value: string; options: Array<{ value: string; label: string; href: string }>; label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="select-wrap sb-month block shrink-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        aria-busy={pending}
        onChange={(e) => {
          const next = options.find((o) => o.value === e.target.value);
          if (next) startTransition(() => router.push(next.href));
        }}
        className="input select"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="select-chev" aria-hidden>
        <Icon name="chevron-down" size={16} />
      </span>
    </label>
  );
}

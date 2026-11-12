"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/** "This month" and the earlier months that have sales; picking one goes to its address. */
export function MonthPicker({ value, options }: { value: string; options: Array<{ value: string; label: string; href: string }> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="relative block shrink-0">
      <span className="sr-only">Month</span>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-500">
        <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </svg>
      <select
        value={value}
        aria-busy={pending}
        onChange={(e) => {
          const next = options.find((o) => o.value === e.target.value);
          if (next) startTransition(() => router.push(next.href));
        }}
        className="h-11 appearance-none rounded-xl border border-line bg-surface pr-8 pl-9 text-[14px] font-bold text-gray-900 focus:border-accent focus:ring-2 focus:ring-tint focus:outline-none md:h-9 md:text-[13px]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-gray-500">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </label>
  );
}

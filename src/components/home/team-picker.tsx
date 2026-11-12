"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { SelectBox } from "@/components/ui/kit";

/** An admin's team on Home (?team=): picking one opens its numbers. */
export function TeamPicker({ value, options, hrefFor }: { value: string; options: Array<{ id: string; label: string }>; hrefFor: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <SelectBox
      small
      aria-label="Which team"
      value={value}
      disabled={pending}
      onChange={(e) => {
        const href = hrefFor[e.target.value];
        if (href) start(() => router.push(href, { scroll: false }));
      }}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </SelectBox>
  );
}

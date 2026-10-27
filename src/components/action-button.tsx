"use client";

import { useState, useTransition } from "react";
import { Button, cn } from "@/components/ui";
import type { ActionResult } from "@/app/(app)/actions";
import { toast } from "@/components/toaster";

type Variant = "primary" | "secondary" | "danger" | "ghost";

/** A button that runs one server action and shows what happened under it. */
export function ActionButton({
  action,
  label,
  busyLabel,
  variant = "secondary",
  confirm,
  className,
  wide = false,
  onDone,
}: {
  action: () => Promise<ActionResult>;
  label: string;
  busyLabel?: string;
  variant?: Variant;
  /** Asked first (window.confirm) for anything that deletes. */
  confirm?: string;
  className?: string;
  wide?: boolean;
  onDone?: (result: ActionResult) => void;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <div className={cn(wide && "w-full")}>
      <Button
        type="button"
        variant={variant}
        disabled={pending}
        className={cn("rounded-2xl", wide && "w-full", className)}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setResult(null);
          start(async () => {
            const r = await action();
            setResult(r);
            toast(r.ok ? (r.message ?? "Done.") : r.error, r.ok);
            onDone?.(r);
          });
        }}
      >
        {pending ? (busyLabel ?? "Working...") : label}
      </Button>
      {result && !result.ok && <p className="mt-2 text-[13px] leading-snug text-red-700">{result.error}</p>}
    </div>
  );
}

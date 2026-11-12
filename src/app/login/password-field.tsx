"use client";

import { useState, type ComponentProps } from "react";
import { Input, cn } from "@/components/ui";

/** A password box with a Show / Hide control at its end (the sign-in, join and profile screens). */
export function PasswordField({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={shown ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={cn("h-12 rounded-2xl pr-[72px] text-[17px]", className)} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-pressed={shown}
        aria-label={shown ? "Hide the password" : "Show the password"}
        className="absolute top-1/2 right-1.5 flex min-h-9 min-w-[56px] -translate-y-1/2 items-center justify-center rounded-xl px-2 text-[13px] font-bold text-accent-text hover:bg-tint"
      >
        {shown ? "Hide" : "Show"}
      </button>
    </div>
  );
}

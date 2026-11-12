"use client";

import { useState, type ComponentProps } from "react";
import { Input, cn } from "@/components/ui";

/** A password box with a Show / Hide control at its end (the sign-in, join and profile screens). */
export function PasswordField({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={shown ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={cn("pr-[72px] text-[15px]", className)} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-pressed={shown}
        aria-label={shown ? "Hide the password" : "Show the password"}
        className="absolute top-1/2 right-1.5 flex min-h-8 min-w-[56px] -translate-y-1/2 items-center justify-center rounded-lg px-2 text-[12.5px] font-medium text-accent-text hover:bg-accent-soft"
      >
        {shown ? "Hide" : "Show"}
      </button>
    </div>
  );
}

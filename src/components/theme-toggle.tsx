"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/components/ui";

/**
 * Dark, light, or follow the phone. Dark is the default for everyone (owner, 2026-11-12), so no
 * saved choice reads as Dark. The choice lives in this browser only (localStorage "theme": "light",
 * "auto", or nothing for dark) and is applied before the first paint by THEME_SCRIPT in the root
 * layout, so pages never flash.
 */
type Choice = "dark" | "light" | "auto";
const KEY = "theme";

function read(): Choice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "auto" ? v : "dark";
  } catch {
    return "dark";
  }
}

const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function apply(choice: Choice) {
  try {
    if (choice === "dark") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  const root = document.documentElement;
  if (choice === "dark") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  listeners.forEach((fn) => fn());
}

const OPTIONS: Array<{ value: Choice; label: string; icon: React.ReactNode }> = [
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      </svg>
    ),
  },
  {
    value: "light",
    label: "Light",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
  },
  {
    value: "auto",
    label: "Auto",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
        <rect x="6" y="2.5" width="12" height="19" rx="3" />
        <path d="M11 18.5h2" />
      </svg>
    ),
  },
];

/** The demo's segmented control: a track, the picked one a pill in the page color. */
export function ThemeToggle({ className }: { className?: string }) {
  const choice = useSyncExternalStore(subscribe, read, () => "dark" as Choice);
  return (
    <div role="radiogroup" aria-label="Appearance" className={cn("grid grid-cols-3 gap-0.5 rounded-xl bg-track p-[3px]", className)}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={choice === o.value}
          onClick={() => apply(o.value)}
          className={cn(
            "flex h-[34px] items-center justify-center gap-1.5 rounded-[9px] text-[12.5px] font-medium transition-colors",
            choice === o.value ? "bg-segment text-fg" : "text-fg-2 hover:text-fg",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

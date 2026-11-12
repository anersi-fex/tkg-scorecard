"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "@/components/ui";

/**
 * The search box sits with the page's controls and the leaderboard it filters sits further down:
 * the two share what was typed through this small context. Nothing leaves the browser.
 */
const SearchContext = createContext<{ q: string; setQ: (q: string) => void }>({ q: "", setQ: () => {} });

export function SearchProvider({ children }: { children: ReactNode }) {
  const [q, setQ] = useState("");
  return <SearchContext.Provider value={{ q, setQ }}>{children}</SearchContext.Provider>;
}

export function useSearch() {
  return useContext(SearchContext);
}

/** "Agent or team name": filters the leaderboard as you type; Enter goes to it. */
export function SearchBox({ className }: { className?: string }) {
  const { q, setQ } = useSearch();
  return (
    <label className={cn("relative block", className)}>
      <span className="sr-only">Search the leaderboard</span>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-500">
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4.5 4.5" />
      </svg>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          // The list this filters is a screen or more further down: Enter (the phone keyboard's
          // Search key) puts the keyboard away and brings the list up.
          if (e.key !== "Enter") return;
          e.preventDefault();
          e.currentTarget.blur();
          document.querySelector('[data-section="leaderboard"]')?.scrollIntoView({ block: "start", behavior: "smooth" });
        }}
        placeholder="Agent or team name"
        autoComplete="off"
        enterKeyHint="search"
        className="h-11 w-full rounded-xl border border-line bg-surface pr-3 pl-9 text-base text-gray-900 placeholder:text-gray-500 focus:border-accent focus:ring-2 focus:ring-tint focus:outline-none md:h-9 md:text-[14px]"
      />
    </label>
  );
}

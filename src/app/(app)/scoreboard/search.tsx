"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "@/components/ui";
import { Icon } from "@/components/ui/icon";

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
export function SearchBox({ className, placeholder = "Agent or team name" }: { className?: string; placeholder?: string }) {
  const { q, setQ } = useSearch();
  return (
    <label className={cn("search-wrap block", className)}>
      <span className="sr-only">Search the leaderboard</span>
      <span className="search-ico" aria-hidden>
        <Icon name="search" size={17} />
      </span>
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
        placeholder={placeholder}
        autoComplete="off"
        enterKeyHint="search"
        className="input search-input"
      />
    </label>
  );
}

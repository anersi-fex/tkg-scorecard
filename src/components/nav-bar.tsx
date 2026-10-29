"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type Ref } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/session";
import { cn } from "@/components/ui";
import { ScoreLockup } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { initials } from "@/components/avatar";
import { logout } from "@/app/login/actions";

/**
 * Tide app shell (the same as Sales Coach). The header (logo, and on a computer the main links)
 * stays at the top and publishes its height as --nav-h. On a phone the main links move to a
 * floating pill at the bottom (TabBar), which publishes --tabbar-h. Everything else (theme, the
 * TV board, Settings, Sign out) sits behind the initials at the top right.
 */

type IconName = "home" | "log" | "wrap" | "team";

interface MainLink {
  href: string;
  label: string;
  icon: IconName;
}

const LINKS: MainLink[] = [
  { href: "/", label: "This month", icon: "home" },
  { href: "/log", label: "Log a sale", icon: "log" },
  { href: "/wrap", label: "Wrap", icon: "wrap" },
  { href: "/team", label: "Team", icon: "team" },
];

function isActive(pathname: string, link: MainLink): boolean {
  if (link.href === "/") return pathname === "/";
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
}

function usePickedLink(pathname: string) {
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedOn, setPickedOn] = useState(pathname);
  if (pickedOn !== pathname) {
    setPickedOn(pathname);
    setPicked(null);
  }
  const isOn = (link: MainLink) => (picked ? picked === link.href : isActive(pathname, link));
  return { isOn, pick: setPicked };
}

function NavIcon({ name, active, size = 22 }: { name: IconName; active: boolean; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true as const };
  if (name === "home") {
    // A podium: the brand's shape as a line icon.
    return (
      <svg {...common} fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth={active ? 0 : 1.9} strokeLinejoin="round">
        <path d="M3 20V13a1 1 0 0 1 1-1h4v8H3zM9 20V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v14H9zM16 20v-5h4a1 1 0 0 1 1 1v4h-5z" />
      </svg>
    );
  }
  if (name === "log") {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth={active ? 2.3 : 1.9} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    );
  }
  if (name === "wrap") {
    // A pennant: the day's flag.
    return (
      <svg {...common} fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth={active ? 1.6 : 1.9} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 21V4" />
        <path d="M6 4h12l-2.5 4 2.5 4H6" />
      </svg>
    );
  }
  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth={active ? 2.3 : 1.9} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" />
      <path d="M16 4.8a3.2 3.2 0 0 1 0 6.4" />
      <path d="M17.5 14.6c1.6.5 2.6 1.9 3 4.4" />
    </svg>
  );
}

function subscribeScroll(fn: () => void) {
  window.addEventListener("scroll", fn, { passive: true });
  return () => window.removeEventListener("scroll", fn);
}
const readScrolled = () => window.scrollY > 2;
const serverScrolled = () => false;

export function NavBar({ role }: { role: Role }) {
  const pathname = usePathname();
  const ref = useRef<HTMLElement | null>(null);
  const scrolled = useSyncExternalStore(subscribeScroll, readScrolled, serverScrolled);
  const { isOn, pick } = usePickedLink(pathname);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--nav-h", `${el.offsetHeight}px`);
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <header
      ref={ref}
      className={cn("sticky top-0 z-30 border-b bg-ink transition-colors has-[[aria-expanded=true]]:z-50", scrolled ? "border-line" : "border-transparent")}
    >
      <div className="mx-auto flex h-[60px] max-w-5xl items-center gap-3 pr-[11px] pl-4 sm:gap-6">
        <Link href="/" aria-label="Scorecard, home" className="-my-1 flex min-h-11 shrink-0 items-center rounded-xl">
          <ScoreLockup size={32} />
        </Link>
        <nav aria-label="Main" className="hidden min-w-0 flex-1 items-center gap-1 sm:flex">
          {LINKS.map((l) => {
            const active = isOn(l);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={isActive(pathname, l) ? "page" : undefined}
                onClick={() => pick(l.href)}
                className={cn(
                  "inline-flex h-11 items-center gap-2 rounded-full px-4 text-[14px] whitespace-nowrap transition-colors",
                  active ? "bg-tint font-bold text-accent-text" : "font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                )}
              >
                <NavIcon name={l.icon} active={active} size={18} />
                {l.label}
              </Link>
            );
          })}
        </nav>
        <AccountMenu role={role} />
      </div>
    </header>
  );
}

function MenuRow({ href, children, icon, external }: { href: string; children: React.ReactNode; icon: React.ReactNode; external?: boolean }) {
  const className = "flex min-h-11 items-center gap-3 rounded-2xl px-2.5 text-[15px] font-semibold text-gray-900 hover:bg-gray-50";
  const chevron = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-gray-400">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        <span className="text-gray-500">{icon}</span>
        <span className="flex-1">{children}</span>
        {chevron}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      <span className="text-gray-500">{icon}</span>
      <span className="flex-1">{children}</span>
      {chevron}
    </Link>
  );
}

/** The initials button and its small sheet: who is signed in, Light / Dark / Auto, the TV board, Settings, Sign out. */
function AccountMenu({ role }: { role: Role }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setOpen(false);
  }
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const name = role === "owner" ? "Anersi Koka" : "Team";
  const roleLabel = role === "owner" ? "Owner" : "Team sign-in";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative ml-auto shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Account: ${name}`}
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-11 items-center justify-center rounded-full"
      >
        <span
          className={cn(
            "flex h-[34px] w-[34px] items-center justify-center rounded-full bg-tint text-[13px] font-bold text-accent-text transition-shadow",
            open && "ring-2 ring-accent ring-offset-2 ring-offset-ink",
          )}
        >
          {role === "owner" ? initials(name) : "T"}
        </span>
      </button>

      <div
        id="account-menu"
        className={cn(
          "absolute top-[calc(100%+6px)] right-0 z-40 w-[min(18.5rem,calc(100vw-1.5rem))] origin-top-right rounded-[22px] bg-surface p-2 shadow-float transition-[opacity,transform,visibility] duration-150",
          open ? "visible scale-100 opacity-100" : "invisible scale-95 opacity-0",
        )}
      >
        <div className="flex items-center gap-3 px-2.5 pt-2 pb-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tint text-[15px] font-bold text-accent-text">
            {role === "owner" ? initials(name) : "T"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold tracking-[-0.01em] text-gray-900">{name}</p>
            <p className="text-[13px] font-medium text-gray-500">{roleLabel}</p>
          </div>
        </div>

        <div className="border-t border-line px-2.5 pt-3 pb-2.5">
          <p className="mb-2 text-[11px] font-bold tracking-[0.09em] text-gray-500 uppercase">Appearance</p>
          <ThemeToggle className="[&_button]:min-h-11" />
        </div>

        <div className="border-t border-line pt-1.5">
          <MenuRow
            href="/board"
            external
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="2.5" y="4" width="19" height="13" rx="2.5" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            }
          >
            Open the TV board
          </MenuRow>
          {role === "owner" && (
            <MenuRow
              href="/settings"
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
                </svg>
              }
            >
              Settings
            </MenuRow>
          )}
          <form action={logout}>
            <button type="submit" className="flex min-h-11 w-full items-center gap-3 rounded-2xl px-2.5 text-left text-[15px] font-semibold text-red-700 hover:bg-red-50">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

const TAB_BOTTOM = "max(14px, calc(env(safe-area-inset-bottom, 0px) - 6px))";
const TAB_HEIGHT = 62;

/** The phone's floating tab bar (computers keep the links in the header). */
export function TabBar() {
  const pathname = usePathname();
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!el) return;
    const publish = () => root.style.setProperty("--tabbar-h", `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.setProperty("--tabbar-h", "0px");
    };
  }, []);

  return <TabBarView pathname={pathname} navRef={ref} />;
}

export function TabBarView({ pathname, navRef }: { pathname: string; navRef?: Ref<HTMLElement> }) {
  const { isOn, pick } = usePickedLink(pathname);
  return (
    <>
      <div aria-hidden className="shrink-0 sm:hidden" style={{ height: `calc(${TAB_HEIGHT}px + ${TAB_BOTTOM} + 10px)` }} />
      <nav ref={navRef} aria-label="Main" className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 sm:hidden" style={{ paddingBottom: TAB_BOTTOM }}>
        <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-surface px-2 shadow-float" style={{ height: TAB_HEIGHT }}>
          {LINKS.map((l) => {
            const active = isOn(l);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={isActive(pathname, l) ? "page" : undefined}
                onClick={() => pick(l.href)}
                className={cn(
                  // Four named tabs fit a 390px phone with the label under the icon (iOS style).
                  "flex h-[50px] w-[76px] flex-col items-center justify-center gap-0.5 rounded-2xl text-[10.5px] leading-none whitespace-nowrap transition-colors max-[359px]:w-[66px]",
                  active ? "bg-tint font-bold text-accent-text" : "font-semibold text-gray-600 active:bg-gray-100",
                )}
              >
                <NavIcon name={l.icon} active={active} size={22} />
                <span>{l.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

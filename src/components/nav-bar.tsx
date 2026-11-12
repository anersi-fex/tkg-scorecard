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
import { pendingApprovalCount } from "@/app/(app)/approvals/actions";

/**
 * Tide app shell (the same as Sales Coach). The header (logo, and on a computer the main links)
 * stays at the top and publishes its height as --nav-h. On a phone the main links move to a
 * strip of their own at the bottom (TabBar, sticky, never over a row), which publishes --tabbar-h. Everything else (the
 * person's profile, theme, the TV board, the phone guide, Settings for the owner and the admins,
 * the owner's Approvals, Sign out) sits behind the viewer's own initials at the top right.
 */

type IconName = "home" | "score" | "log" | "wrap" | "team";

interface MainLink {
  href: string;
  label: string;
  icon: IconName;
}

const LINKS: MainLink[] = [
  { href: "/", label: "This month", icon: "home" },
  { href: "/scoreboard", label: "Scoreboard", icon: "score" },
  { href: "/log", label: "Log a sale", icon: "log" },
  { href: "/wrap", label: "Wrap", icon: "wrap" },
  { href: "/team", label: "People", icon: "team" },
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
  if (name === "score") {
    // A table: the Scoreboard's rows and columns.
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth={active ? 2.3 : 1.9} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
        <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" />
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

export interface NavBarProps {
  role: Role;
  /** The agency's name under "Scorecard" (Settings > agency name). */
  agency?: string;
  /** The signed-in person's name, when the sign-in names a person; the shared sign-ins show "Owner" or "Team". */
  name?: string | null;
  /** owner, admin, member or team once the sign-in carries a level; without it the role decides. */
  level?: "owner" | "admin" | "member" | "team" | null;
  /** How many requests wait for the owner's yes, when the layout already knows; the bar asks for itself otherwise. */
  approvals?: number;
}

/** Sent on `window` when the owner answers a request (the Approvals page), so the badge counts again. */
export const APPROVALS_CHANGED = "sc-approvals-changed";

/** The owner's waiting requests (the badge on the initials): asked once the bar shows and again on each page change. Nobody else asks. */
function useApprovalCount(isOwner: boolean, pathname: string, initial: number): number {
  const [count, setCount] = useState(initial);
  useEffect(() => {
    if (!isOwner) return;
    let live = true;
    const ask = () => {
      pendingApprovalCount()
        .then((n) => {
          if (live) setCount(n);
        })
        .catch(() => {});
    };
    ask();
    // The Approvals page says so when the owner answers one, so the badge follows at once.
    window.addEventListener(APPROVALS_CHANGED, ask);
    return () => {
      live = false;
      window.removeEventListener(APPROVALS_CHANGED, ask);
    };
  }, [isOwner, pathname]);
  return isOwner ? count : 0;
}

export function NavBar({ role, agency, name, level, approvals = 0 }: NavBarProps) {
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
          <ScoreLockup size={32} agency={agency} />
        </Link>
        <nav aria-label="Main" className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-hidden sm:flex lg:gap-1">
          {LINKS.map((l) => {
            const active = isOn(l);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={isActive(pathname, l) ? "page" : undefined}
                onClick={() => pick(l.href)}
                className={cn(
                  // Five links: tighter, and without the icons, on a narrow window.
                  "inline-flex h-11 items-center gap-2 rounded-full px-2.5 text-[14px] whitespace-nowrap transition-colors lg:px-4 [&>svg]:hidden lg:[&>svg]:block",
                  active ? "bg-tint font-bold text-accent-text" : "font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                )}
              >
                <NavIcon name={l.icon} active={active} size={18} />
                {l.label}
              </Link>
            );
          })}
        </nav>
        <AccountMenu role={role} person={name ?? null} level={level ?? (role === "owner" ? "owner" : "team")} approvals={approvals} />
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

/**
 * The initials button (the viewer's own initials) and its small sheet: who is signed in and their
 * profile, Light / Dark / Auto, the TV board, the phone guide, Settings (the owner and the
 * admins), Approvals with how many wait (the owner), Sign out.
 */
const LEVEL_LABEL = { owner: "Owner", admin: "Admin", member: "Signed in", team: "Team sign-in" } as const;

function AccountMenu({ role, person, level, approvals }: { role: Role; person: string | null; level: keyof typeof LEVEL_LABEL; approvals: number }) {
  const pathname = usePathname();
  const manager = level === "owner" || level === "admin";
  const waiting = useApprovalCount(level === "owner", pathname, approvals);
  const [open, setOpen] = useState(false);
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setOpen(false);
  }
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const name = person?.trim() || (role === "owner" ? "Owner" : "Team");
  const roleLabel = LEVEL_LABEL[level] ?? LEVEL_LABEL.team;
  const badge = person?.trim() ? initials(name) : role === "owner" ? "O" : "T";

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
        aria-label={waiting > 0 ? `Account: ${name}. ${waiting} waiting for your OK` : `Account: ${name}`}
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-11 w-11 items-center justify-center rounded-full"
      >
        <span
          className={cn(
            "flex h-[34px] w-[34px] items-center justify-center rounded-full bg-tint text-[13px] font-bold text-accent-text transition-shadow",
            open && "ring-2 ring-accent ring-offset-2 ring-offset-ink",
          )}
        >
          {badge}
        </span>
        {waiting > 0 && (
          <span data-approvals-badge aria-hidden className="absolute -top-0.5 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 font-mono text-[11px] leading-none font-bold text-white ring-2 ring-ink">
            {waiting > 9 ? "9+" : waiting}
          </span>
        )}
      </button>

      <div
        id="account-menu"
        className={cn(
          "absolute top-[calc(100%+6px)] right-0 z-40 w-[min(19.75rem,calc(100vw-1.5rem))] origin-top-right rounded-[22px] bg-surface p-2 shadow-float transition-[opacity,transform,visibility] duration-150",
          open ? "visible scale-100 opacity-100" : "invisible scale-95 opacity-0",
        )}
      >
        <div className="flex items-center gap-3 px-2.5 pt-2 pb-2">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tint text-[15px] font-bold text-accent-text">
            {badge}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold tracking-[-0.01em] text-gray-900">{name}</p>
            <p className="text-[13px] font-medium text-gray-500">{roleLabel}</p>
          </div>
        </div>
        {level !== "team" && (
          <div className="pb-1.5">
            <MenuRow
              href="/me"
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="8.2" r="3.7" />
                  <path d="M4.5 20c1-3.6 4-5.4 7.5-5.4s6.5 1.8 7.5 5.4" />
                </svg>
              }
            >
              Your profile
            </MenuRow>
          </div>
        )}

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
          <MenuRow
            href="/install"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" />
                <path d="M12 8v6M9.5 11.5 12 14l2.5-2.5" />
              </svg>
            }
          >
            Put Scorecard on your phone
          </MenuRow>
          {manager && (
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
          {level === "owner" && (
            <MenuRow
              href="/approvals"
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3l7 3v5.5c0 4.3-2.9 7.4-7 9-4.1-1.6-7-4.7-7-9V6l7-3z" />
                  <path d="M8.8 12.2l2.3 2.3 4.2-4.6" />
                </svg>
              }
            >
              <span className="flex items-center gap-2">
                Approvals
                {waiting > 0 && (
                  <span data-approvals-count className="flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 font-mono text-[11.5px] leading-none font-bold text-white">
                    {waiting > 99 ? "99+" : waiting}
                  </span>
                )}
              </span>
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

const TAB_HEIGHT = 62;

/** A field that brings up the phone's keyboard (or a picker) when it has focus. */
function takesTyping(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable) return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["checkbox", "radio", "button", "submit", "reset", "range", "file", "color"].includes(type);
}

/**
 * True while the phone's keyboard is likely up (owner, 2026-11-04: "the keyboard pulls up, and then so do
 * the bottom menu buttons ... really annoying"): a field that takes typing has focus on a touch screen, or
 * the visible part of the screen shrank by more than a browser bar would. The tab bar hides meanwhile and
 * comes back when the keyboard goes.
 */
function useKeyboardUp(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const vv = window.visualViewport;
    let timer: number | undefined;
    const compute = () => {
      const shrunk = vv ? window.innerHeight - vv.height > 120 : false;
      setUp(shrunk || (coarse && takesTyping(document.activeElement)));
    };
    // After a blur the focus may land on another field in the same tick: look again a moment later.
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(compute, 60);
    };
    document.addEventListener("focusin", compute);
    document.addEventListener("focusout", later);
    vv?.addEventListener("resize", compute);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("focusin", compute);
      document.removeEventListener("focusout", later);
      vv?.removeEventListener("resize", compute);
    };
  }, []);
  return up;
}

/** The phone's tab bar, a strip of its own at the bottom (computers keep the links in the header). */
export function TabBar() {
  const pathname = usePathname();
  const ref = useRef<HTMLElement | null>(null);
  const keyboardUp = useKeyboardUp();

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

  return <TabBarView pathname={pathname} navRef={ref} hidden={keyboardUp} />;
}

export function TabBarView({ pathname, navRef, hidden = false }: { pathname: string; navRef?: Ref<HTMLElement>; hidden?: boolean }) {
  const { isOn, pick } = usePickedLink(pathname);
  return (
    // Its own strip at the end of the page (owner, 2026-11-04: "its own container ... make it sticky"): it
    // sticks to the bottom edge while the page is longer than the screen and rests in its own place at the
    // very end, so no row is ever under it. Solid, a hairline above, the home indicator's space inside it.
    // While the keyboard is up it is gone, so it never rides on top of the keyboard.
    <nav
      ref={navRef}
      data-tabbar
      aria-label="Main"
      hidden={hidden}
      className={cn("sticky bottom-0 z-30 mt-auto border-t border-line bg-surface sm:hidden", hidden && "!hidden")}
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto flex w-full max-w-xl items-center justify-around gap-1 px-2" style={{ height: TAB_HEIGHT }}>
        {LINKS.map((l) => {
          const active = isOn(l);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(pathname, l) ? "page" : undefined}
              onClick={() => pick(l.href)}
              className={cn(
                // Five named tabs fit a 390px phone (459px of layout at 85%) with the label under the icon (iOS style).
                "flex h-[50px] min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10.5px] leading-none whitespace-nowrap transition-colors",
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
  );
}

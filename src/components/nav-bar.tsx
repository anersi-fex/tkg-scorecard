"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Level } from "@/lib/viewer";
import { LEVEL_LABEL } from "@/lib/viewer";
import { nav, type NavItem as RuleNavItem } from "@/lib/rules";
import { cn } from "@/components/ui";
import { ScoreLockup } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { initials } from "@/components/avatar";
import { Icon, type IconName } from "@/components/ui/icon";
import { logout } from "@/app/login/actions";
import { pendingApprovalCount } from "@/app/(app)/approvals/actions";

/**
 * The app shell (owner, 2026-11-12, the demo he approved). Computers (1024px and up): a left
 * sidebar with the lockup, a gradient "Log a sale" button, Home, Scoreboard, Policies ("My
 * policies" for an agent), People, then Settings and Approvals for those who have them, and at the
 * bottom the TV board and the person card that opens the menu. Phones and tablets: a top bar (the
 * lockup and the initials) and a tab bar of its own at the end of the page: Home, Scoreboard, the
 * raised gradient "+" (Log a sale), Policies, People. The menu: the name and level, Your profile,
 * Light / Dark / Auto, the TV board, the phone guide, Settings (the owner and the admins),
 * Approvals with its count (the owner), Sign out. The shared team password sees the boards only:
 * Home, Scoreboard and People, no Log a sale and no Policies (decision 2).
 */

export interface NavItem {
  href: string;
  label: string;
  /** The tab bar's shorter word, when it differs ("Policies" for "My policies"). */
  tabLabel?: string;
  icon: IconName;
  /** The gradient one: the sidebar's button and the phone's raised "+". */
  primary?: boolean;
}

const NAV_ICON: Partial<Record<RuleNavItem["id"], IconName>> = { home: "home", scoreboard: "chart", log: "plus", policies: "file", people: "people" };

/**
 * The main links for a level, from the rules (`nav` in src/lib/rules.ts, the demo's Perms.nav).
 * A link that needs a person's own sign-in is left out for the shared team password, so its nav
 * holds the boards only: Home, Scoreboard and People (the pages themselves still say "This needs
 * your own sign-in." to anyone who opens them by address).
 */
export function navFor(level: Level): NavItem[] {
  return nav({ level, agentId: null })
    .items.filter((i) => !i.needsOwnSignIn)
    .map((i) => ({ href: i.href, label: i.label, tabLabel: i.tabLabel, icon: NAV_ICON[i.id] ?? "dot", primary: i.primary }));
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** A tap lights its link at once (before the next page arrives); a new path clears the guess. */
function usePickedLink(pathname: string) {
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedOn, setPickedOn] = useState(pathname);
  if (pickedOn !== pathname) {
    setPickedOn(pathname);
    setPicked(null);
  }
  const isOn = (href: string) => (picked ? picked === href : isActive(pathname, href));
  return { isOn, pick: setPicked };
}

/** Whether the computer layout (the sidebar) shows: null until the browser says (the server renders both, each hidden by CSS). */
const WIDE = "(min-width: 1024px)";
function subscribeWide(fn: () => void) {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
}
const readWide = () => window.matchMedia(WIDE).matches;
const serverWide = () => null;
function useWide(): boolean | null {
  return useSyncExternalStore<boolean | null>(subscribeWide, readWide, serverWide);
}

/** Sent on `window` when the owner answers a request (the Approvals page), so the badge counts again. */
export const APPROVALS_CHANGED = "sc-approvals-changed";

/** The owner's waiting requests: the count from the layout, asked again on each page change and when the Approvals page answers one. */
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
    window.addEventListener(APPROVALS_CHANGED, ask);
    return () => {
      live = false;
      window.removeEventListener(APPROVALS_CHANGED, ask);
    };
  }, [isOwner, pathname]);
  return isOwner ? count : 0;
}

export interface ShellProps {
  level: Level;
  /** The signed-in person's name ("Team" for the shared team password). */
  name: string;
  /** The agency's name under "Scorecard" (Settings > Agency name). */
  agency?: string;
  /** How many requests wait for the owner's yes (0 for anyone else). */
  approvals?: number;
}

/** Open and close the person menu: an outside tap, Escape (back to the button) or a new page closes it. */
function useMenu(pathname: string) {
  const [open, setOpen] = useState(false);
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setOpen(false);
  }
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
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
  return { open, setOpen, wrapRef, buttonRef };
}

function MenuLink({ href, icon, children, external }: { href: string; icon: IconName; children: ReactNode; external?: boolean }) {
  const inner = (
    <>
      <Icon name={icon} size={18} className="text-fg-2" />
      <span className="menu-label flex items-center gap-2">{children}</span>
    </>
  );
  if (external)
    return (
      <a href={href} target="_blank" rel="noreferrer" className="menu-item">
        {inner}
      </a>
    );
  return (
    <Link href={href} className="menu-item">
      {inner}
    </Link>
  );
}

/** The menu's contents (the same on a phone and a computer). */
function MenuBody({ level, name, waiting, countAttr }: { level: Level; name: string; waiting: number; countAttr: boolean }) {
  const admin = level === "owner" || level === "admin";
  return (
    <div className="menu">
      <div className="menu-head">
        <p className="menu-name truncate">{name}</p>
        <p className="menu-sub">{LEVEL_LABEL[level]}</p>
      </div>
      {level !== "team" && (
        <MenuLink href="/me" icon="user">
          Your profile
        </MenuLink>
      )}
      <div className="theme-pick">
        <ThemeToggle />
      </div>
      <MenuLink href="/board" icon="tv" external>
        TV board
      </MenuLink>
      <MenuLink href="/install" icon="phone">
        Put Scorecard on your phone
      </MenuLink>
      {admin && (
        <MenuLink href="/settings" icon="gear">
          Settings
        </MenuLink>
      )}
      {level === "owner" && (
        <MenuLink href="/approvals" icon="check">
          Approvals
          {waiting > 0 && (
            <span {...(countAttr ? { "data-approvals-count": "" } : {})} className="badge num ml-auto">
              {waiting > 99 ? "99+" : waiting}
            </span>
          )}
        </MenuLink>
      )}
      <div className="menu-sep" />
      <form action={logout}>
        <button type="submit" className="menu-item">
          <Icon name="logout" size={18} className="text-fg-2" />
          <span className="menu-label">Sign out</span>
        </button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ the computer's sidebar

export function Sidebar({ level, name, agency, approvals = 0 }: ShellProps) {
  const pathname = usePathname();
  const wide = useWide();
  const { isOn, pick } = usePickedLink(pathname);
  const waiting = useApprovalCount(level === "owner", pathname, approvals);
  const { open, setOpen, wrapRef, buttonRef } = useMenu(pathname);
  const items = navFor(level);
  const log = items.find((i) => i.primary);
  const main = items.filter((i) => !i.primary);
  const admin = level === "owner" || level === "admin";
  // Only the layout that shows carries the menu's id and the badge's mark (one of each on the page).
  const mine = wide === true;

  const item = (href: string, label: string, icon: IconName, extra?: ReactNode) => {
    const on = isOn(href);
    return (
      <Link key={href} href={href} onClick={() => pick(href)} className={cn("nav-item", on && "on")} aria-current={isActive(pathname, href) ? "page" : undefined}>
        <Icon name={icon} size={19} />
        <span className="nav-label">{label}</span>
        {extra}
      </Link>
    );
  };

  return (
    <aside className="side" aria-label="Scorecard">
      <Link href="/" aria-label="Scorecard, home" className="side-brand rounded-xl">
        <ScoreLockup size={34} agency={agency} />
      </Link>
      {log && (
        <Link href={log.href} onClick={() => pick(log.href)} className="btn btn-primary btn-full side-log" aria-current={isActive(pathname, log.href) ? "page" : undefined}>
          <Icon name="plus" size={18} stroke={2.2} />
          <span>{log.label}</span>
        </Link>
      )}
      <nav className="side-nav" aria-label="Main">
        {main.map((i) => item(i.href, i.label, i.icon))}
        {admin && <div className="side-sep" />}
        {admin && item("/settings", "Settings", "gear")}
        {level === "owner" &&
          item(
            "/approvals",
            "Approvals",
            "check",
            waiting > 0 ? (
              <span {...(mine ? { "data-approvals-badge": "" } : {})} className="badge num">
                {waiting > 9 ? "9+" : waiting}
              </span>
            ) : null,
          )}
      </nav>
      <div className="side-foot">
        <a href="/board" target="_blank" rel="noreferrer" className="nav-item">
          <Icon name="tv" size={19} />
          <span className="nav-label">TV board</span>
        </a>
        <div ref={wrapRef} className="relative">
          <button
            ref={buttonRef}
            type="button"
            className="me-chip"
            aria-expanded={open}
            aria-controls={mine ? "account-menu" : undefined}
            aria-label={waiting > 0 ? `Account: ${name}. ${waiting} waiting for your OK` : `Account: ${name}`}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="avatar" aria-hidden>
              {initials(name)}
            </span>
            <span className="me-text">
              <span className="me-name">{name}</span>
              <span className="me-role">{LEVEL_LABEL[level]}</span>
            </span>
          </button>
          <div id={mine ? "account-menu" : undefined} className="me-pop at-side" data-open={open}>
            <MenuBody level={level} name={name} waiting={waiting} countAttr={mine} />
          </div>
        </div>
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ the phone's top bar

function subscribeScroll(fn: () => void) {
  window.addEventListener("scroll", fn, { passive: true });
  return () => window.removeEventListener("scroll", fn);
}
const readScrolled = () => window.scrollY > 2;
const serverScrolled = () => false;

export function TopBar({ level, name, agency, approvals = 0 }: ShellProps) {
  const pathname = usePathname();
  const wide = useWide();
  const ref = useRef<HTMLElement | null>(null);
  const scrolled = useSyncExternalStore(subscribeScroll, readScrolled, serverScrolled);
  const waiting = useApprovalCount(level === "owner", pathname, approvals);
  const { open, setOpen, wrapRef, buttonRef } = useMenu(pathname);
  const mine = wide === false;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--nav-h", `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--nav-h");
    };
  }, []);

  return (
    <header ref={ref} className={cn("topbar", scrolled && "is-scrolled")}>
      <Link href="/" aria-label="Scorecard, home" className="flex min-h-11 min-w-0 items-center rounded-xl">
        <ScoreLockup size={30} agency={agency} />
      </Link>
      <div ref={wrapRef} className="relative">
        <button
          ref={buttonRef}
          type="button"
          className="top-me"
          aria-expanded={open}
          aria-controls={mine ? "account-menu" : undefined}
          aria-label={waiting > 0 ? `Account: ${name}. ${waiting} waiting for your OK` : `Account: ${name}`}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="avatar" aria-hidden>
            {initials(name)}
          </span>
          {waiting > 0 && (
            <span {...(mine ? { "data-approvals-badge": "" } : {})} aria-hidden className="top-dot">
              {waiting > 9 ? "9+" : waiting}
            </span>
          )}
        </button>
        <div id={mine ? "account-menu" : undefined} className="me-pop at-top" data-open={open}>
          <MenuBody level={level} name={name} waiting={waiting} countAttr={mine} />
        </div>
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ the phone's tab bar

/** A field that brings up the phone's keyboard (or a picker) when it has focus. */
function takesTyping(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable) return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["checkbox", "radio", "button", "submit", "reset", "range", "file", "color"].includes(type);
}

/**
 * True while the phone's keyboard is likely up (owner, 2026-11-04: the bottom menu riding on the
 * keyboard is "really annoying"): a field that takes typing has focus on a touch screen, or the
 * visible part of the screen shrank by more than a browser bar would. The tab bar hides meanwhile.
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
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(compute, 60);
    };
    // Hide at once, show late: a tap on a button moves the focus off the text field mid-tap, and a
    // bar that came back that instant would slide under the finger and take the tap meant for the row.
    const onFocusIn = () => (takesTyping(document.activeElement) ? compute() : later());
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", later);
    vv?.addEventListener("resize", compute);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", later);
      vv?.removeEventListener("resize", compute);
    };
  }, []);
  return up;
}

/** The phone's tab bar, a strip of its own at the end of the page (computers have the sidebar). */
export function TabBar({ level }: { level: Level }) {
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

  return <TabBarView pathname={pathname} level={level} navRef={ref} hidden={keyboardUp} />;
}

export function TabBarView({ pathname, level, navRef, hidden = false }: { pathname: string; level: Level; navRef?: Ref<HTMLElement>; hidden?: boolean }) {
  const { isOn, pick } = usePickedLink(pathname);
  const items = navFor(level);
  return (
    // Its own strip at the end of the page (owner, 2026-11-04: "its own container ... make it
    // sticky"): it sticks to the bottom edge while the page is longer than the screen and rests in
    // its own place at the very end, so no row is ever under it. Gone while the keyboard is up.
    <nav ref={navRef} data-tabbar aria-label="Tabs" hidden={hidden} className="tabbar">
      <div className="tabbar-row" style={{ ["--tabs" as string]: items.length }}>
        {items.map((it) => {
          const on = isOn(it.href);
          const current = isActive(pathname, it.href) ? "page" : undefined;
          if (it.primary)
            return (
              <Link key={it.href} href={it.href} onClick={() => pick(it.href)} aria-current={current} className={cn("tab tab-plus", on && "on")}>
                <span className="tab-plus-btn" aria-hidden>
                  <Icon name="plus" size={24} stroke={2.2} />
                </span>
                <span className="tab-label">{it.label}</span>
              </Link>
            );
          return (
            <Link key={it.href} href={it.href} onClick={() => pick(it.href)} aria-current={current} className={cn("tab", on && "on")}>
              <Icon name={it.icon} size={22} />
              <span className="tab-label">{it.tabLabel ?? it.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

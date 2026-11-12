import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { TEAM_TIME_ZONE } from "@/lib/timezone";

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "quiet";

/**
 * Buttons in the demo's look (the .btn classes in globals.css): primary wears the Scorecard
 * gradient with white words; secondary is a hairline outline; quiet a raised fill; ghost the
 * secondary text color; danger a rose outline (behind and removing never wear the brand red).
 */
const variantClasses: Record<ButtonVariant, string> = {
  primary: "btn btn-primary",
  secondary: "btn btn-secondary",
  danger: "btn btn-danger",
  ghost: "btn btn-ghost",
  quiet: "btn btn-quiet",
};

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button {...props} className={cn(variantClasses[variant], "h-auto min-h-10 py-2 text-center leading-tight whitespace-normal", className)} />;
}

export function LinkButton({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link {...props} className={cn(variantClasses[variant], "h-auto min-h-10 py-2 text-center leading-tight whitespace-normal", className)} />;
}

/** The filled input (no border, radius 10, 44px tall; a coral ring on keyboard focus). */
export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cn("input", className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cn("textarea", className)} />;
}

/** A select with the chevron (the wrapper takes `wrapClassName`; `className` goes on the select itself). */
export function Select({ className, wrapClassName, ...props }: ComponentProps<"select"> & { wrapClassName?: string }) {
  return (
    <span className={cn("select-wrap block", props.disabled && "is-disabled", wrapClassName)}>
      <select {...props} className={cn("select", className)} />
      <span className="select-chev" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6.5 9.5 12 15l5.5-5.5" />
        </svg>
      </span>
    </span>
  );
}

/** The label above a field (500 weight, the main text color). */
export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label {...props} className={cn("mb-2 block text-[13.5px] font-medium text-fg", className)} />;
}

/** A card: the card color, a 1px hairline, radius 16, no shadow (the demo's .card). */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl border border-line bg-surface p-4 sm:p-5", className)}>{children}</div>;
}

/** The page title (500 weight, 27px; 24px on a phone) with a line under it and an action at the right. */
export function PageTitle({ children, action, sub }: { children: ReactNode; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[24px] leading-tight font-medium tracking-[-0.01em] text-fg sm:text-[27px]">{children}</h1>
        {sub && <p className="mt-1 text-[13.5px] text-fg-2">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

type BadgeTone = "gray" | "blue" | "green" | "amber" | "red" | "purple";
const badgeTones: Record<BadgeTone, string> = {
  gray: "bg-flat-bg text-flat",
  blue: "bg-chip text-chip-text",
  green: "bg-up-bg text-up",
  amber: "bg-down-bg text-down",
  red: "bg-rose-bg text-rose",
  purple: "bg-purple-100 text-purple-800",
};

/** A small pill (the demo's .pill). */
export function Badge({ tone = "gray", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-[22px] items-center rounded-full px-[9px] text-[12px] leading-none font-medium whitespace-nowrap", badgeTones[tone], className)}>{children}</span>;
}

/** A quiet message in a tinted box (blue = info, red = a problem, green = done, amber = behind or waiting). */
export function Notice({ tone = "blue", children }: { tone?: "blue" | "red" | "green" | "amber"; children: ReactNode }) {
  const tones = {
    blue: "border-blue-200 bg-info-bg text-info",
    red: "border-red-200 bg-rose-bg text-rose",
    green: "border-green-200 bg-up-bg text-up",
    amber: "border-amber-200 bg-down-bg text-down",
  };
  return <div className={cn("rounded-xl border px-3.5 py-2.5 text-[13.5px] font-medium", tones[tone])}>{children}</div>;
}

/** "Oct 27, 2026" from a date-only string or an instant (shown in Detroit time). */
export function formatDate(iso: string | null | undefined, opts: { year?: boolean } = {}): string {
  if (!iso) return "";
  const dateOnly = iso.length === 10;
  const d = new Date(dateOnly ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(opts.year === false ? {} : { year: "numeric" }),
    ...(dateOnly ? {} : { timeZone: TEAM_TIME_ZONE }),
  });
}

let dateTimeFormat: Intl.DateTimeFormat | null = null;
/** "Oct 27, 10:42 AM" in Detroit time. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  dateTimeFormat ??= new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TEAM_TIME_ZONE });
  return dateTimeFormat.format(d);
}

let timeFormat: Intl.DateTimeFormat | null = null;
/** "10:42 AM" in Detroit time. */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  timeFormat ??= new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TEAM_TIME_ZONE });
  return timeFormat.format(d);
}

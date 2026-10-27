import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { TEAM_TIME_ZONE } from "@/lib/timezone";

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-tide-strong text-white shadow-glow hover:brightness-110 disabled:opacity-50 disabled:shadow-none",
  secondary: "bg-surface text-gray-900 border border-line shadow-card hover:bg-gray-50 disabled:text-gray-400",
  danger: "bg-danger text-white hover:brightness-110 disabled:opacity-50",
  ghost: "text-accent-text hover:bg-tint",
};

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed",
        variantClasses[variant],
        className,
      )}
    />
  );
}

export function LinkButton({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return (
    <Link
      {...props}
      className={cn("inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition", variantClasses[variant], className)}
    />
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={cn(
        "min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-gray-900 placeholder:text-gray-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none",
        className,
      )}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-gray-900 placeholder:text-gray-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none",
        className,
      )}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={cn(
        "min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none",
        className,
      )}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label {...props} className={cn("mb-1 block text-sm font-medium text-gray-700", className)} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-[22px] bg-surface p-4 shadow-card", className)}>{children}</div>;
}

export function PageTitle({ children, action, sub }: { children: ReactNode; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.035em] text-gray-900">{children}</h1>
        {sub && <p className="mt-0.5 text-[14px] font-medium text-gray-500">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

type BadgeTone = "gray" | "blue" | "green" | "amber" | "red" | "purple";
const badgeTones: Record<BadgeTone, string> = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-blue-100 text-blue-800",
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  purple: "bg-purple-100 text-purple-800",
};

export function Badge({ tone = "gray", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold", badgeTones[tone], className)}>{children}</span>;
}

export function Notice({ tone = "blue", children }: { tone?: "blue" | "red" | "green" | "amber"; children: ReactNode }) {
  const tones = {
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    red: "border-red-200 bg-red-50 text-red-900",
    green: "border-green-200 bg-green-50 text-green-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
  };
  return <div className={cn("rounded-2xl border px-3.5 py-2.5 text-sm", tones[tone])}>{children}</div>;
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

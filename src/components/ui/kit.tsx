import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/components/ui";
import { Icon, type IconName } from "@/components/ui/icon";
import { STATUS_KEY, NO_STATUS, type PolicyStatus } from "@/lib/policy-types";

/**
 * The demo's kit as React pieces (server-safe: no hooks; the interactive ones live in
 * segmented.tsx and data-table.tsx). Each draws the shared classes in globals.css (.card, .kpi,
 * .status, .chip, .pill, .seg, .field, .input, .select, .list-row, .dl, .timeline, .empty ...),
 * so a page can also write that markup by hand. Colors are tokens only.
 */

// ---------------------------------------------------------------- page

/** The page's head: an optional back link, the title (500 weight, 27px; 24px on a phone), a line under it, tools on the right. */
export function PageHead({
  title,
  sub,
  right,
  back,
  className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  /** Tools on the right (a segmented control, buttons); they wrap under the title on a phone. */
  right?: ReactNode;
  back?: { href: string; label?: string };
  className?: string;
}) {
  return (
    <header className={cn("page-head", className)}>
      {back && (
        <Link href={back.href} className="back-link">
          <Icon name="chevron-left" size={16} />
          <span>{back.label ?? "Back"}</span>
        </Link>
      )}
      <div className="page-head-row">
        <div className="page-titles">
          <h1 className="page-title">{title}</h1>
          {sub != null && sub !== false && <p className="page-sub">{sub}</p>}
        </div>
        {right && <div className="page-tools">{right}</div>}
      </div>
    </header>
  );
}

/** A card (--card fill, 1px line, radius 16, no shadow): optional title, sub, right side and foot. `flush` drops the padding (a table). */
export function Panel({
  title,
  sub,
  right,
  foot,
  flush,
  className,
  children,
  ...rest
}: {
  title?: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  foot?: ReactNode;
  flush?: boolean;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentProps<"section">, "title">) {
  return (
    <section className={cn("card", flush && "card-flush", className)} {...rest}>
      {(title != null || right != null) && (
        <div className="card-head">
          <div className="card-titles">
            {title != null && <h2 className="card-title">{title}</h2>}
            {sub != null && <div className="card-sub">{sub}</div>}
          </div>
          {right != null && <div className="card-right">{right}</div>}
        </div>
      )}
      {children}
      {foot != null && <div className="card-foot">{foot}</div>}
    </section>
  );
}

/**
 * A number card (the demo's .kpi): the label, the big number (tabular), a small unit after it, a
 * line under it, chips. `pace` adds the "On pace for $X" line with its trend icon (owner,
 * 2026-11-12: "what we would be on pace for ... somewhere convenient"); `big` is the Production card.
 */
export function StatCard({
  label,
  value,
  unit,
  sub,
  chip,
  right,
  pace,
  big,
  href,
  className,
  children,
  ...rest
}: {
  label: ReactNode;
  value: ReactNode;
  /** Small words after the number ("of 32"). */
  unit?: ReactNode;
  sub?: ReactNode;
  /** Chips under the number (a DeltaChip). */
  chip?: ReactNode;
  /** Something at the label's right ("Nov 1 – 12"). */
  right?: ReactNode;
  /** The projected total as already-formatted money ("$213,808"); its own line at the card's foot. */
  pace?: ReactNode;
  big?: boolean;
  /** The whole card is a link (a status count into Policies). */
  href?: string;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentProps<"section">, "title">) {
  const inner = (
    <>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {right}
      </div>
      <div className="kpi-value num">
        {value}
        {unit != null && <small>{unit}</small>}
      </div>
      {chip != null && <div className="kpi-chip">{chip}</div>}
      {sub != null && <div className="kpi-sub">{sub}</div>}
      {children}
      {pace != null && <PaceLine value={pace} />}
    </>
  );
  const cls = cn("card kpi", big && "kpi-big", href && "kpi-action", className);
  if (href)
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  return (
    <section className={cls} {...rest}>
      {inner}
    </section>
  );
}

/** "↗ On pace for  $213,808" on its own line, a hairline above (inside a StatCard or any card). */
export function PaceLine({ value, label = "On pace for", className }: { value: ReactNode; label?: ReactNode; className?: string }) {
  return (
    <div className={cn("mt-4 flex items-center justify-between gap-3 border-t border-line pt-4", className)} data-pace>
      <span className="flex items-center gap-2 text-[14px] text-fg-2">
        <Icon name="trend-up" size={17} className="text-accent" />
        {label}
      </span>
      <span className="num text-[22px] font-medium tracking-[-0.01em] text-fg">{value}</span>
    </div>
  );
}

/** The thin progress line toward a goal: the gradient on a track. `value` 0..1. */
export function Rail({ value, thin, className, label }: { value: number; thin?: boolean; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <div className={cn("rail", thin && "thin", className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------- chips and pills

/** A policy status pill: Submitted (flat), Underwriting (amber), Approved (blue), Issued (green), Declined (rose), Cancelled (dim); null reads "No status yet". */
export function StatusPill({ status, small, className }: { status: PolicyStatus | null | undefined; small?: boolean; className?: string }) {
  if (!status) return <span className={cn("pill pill-dim", small && "sm", className)}>{NO_STATUS}</span>;
  return <span className={cn("status", `st-${STATUS_KEY[status]}`, small && "sm", className)}>{status}</span>;
}

export type PillTone = "flat" | "up" | "down" | "blue" | "rose" | "accent" | "dim";
/** A small pill: flat (default), up, down, blue, rose, accent, dim. */
export function Pill({ tone = "flat", small, title, className, children }: { tone?: PillTone; small?: boolean; title?: string; className?: string; children: ReactNode }) {
  return (
    <span className={cn("pill", `pill-${tone}`, small && "sm", className)} title={title}>
      {children}
    </span>
  );
}

/** The level tag: Agent (flat), Manager (blue), Admin and "Admin · owner" (accent). */
export function RoleTag({ level, className }: { level: "owner" | "admin" | "manager" | "member" | "team"; className?: string }) {
  const label = { owner: "Admin · owner", admin: "Admin", manager: "Manager", member: "Agent", team: "Team password" }[level];
  const tone = level === "owner" || level === "admin" ? "role-admin" : level === "manager" ? "role-manager" : "role-agent";
  return <span className={cn("pill", tone, className)}>{label}</span>;
}

/** Places since yesterday: 0 "–", +n "↑ n", −n "↓ n", null "new", undefined nothing. */
export function RankChip({ change, big }: { change: number | null | undefined; big?: boolean }) {
  if (change === undefined) return null;
  if (change === null)
    return (
      <span className={cn("chip flat", big && "chip-lg")} title="New on the board since yesterday">
        new
      </span>
    );
  if (change === 0)
    return (
      <span className={cn("chip flat dash", big && "chip-lg")} title="No change since yesterday">
        –
      </span>
    );
  const up = change > 0;
  return (
    <span className={cn("chip", up ? "up" : "down", big && "chip-lg")} title={`${up ? "Up" : "Down"} ${Math.abs(change)} since yesterday`}>
      <Icon name={up ? "up" : "down"} size={11} stroke={2.2} />
      {Math.abs(change)}
    </span>
  );
}

/**
 * The "vs Oct 1 – 12" chip: up or down by `text`, or "–". When the earlier period had no sales at all
 * (`first`), a quiet "First month on Scorecard" stands in for the arrow (decision 13).
 */
export function DeltaChip({ diff, text, vs, first }: { diff: number; text: string; vs?: string; first?: boolean }) {
  if (first) return <span className="chip-note">First month on Scorecard</span>;
  const vsEl = vs ? <span className="chip-vs">vs {vs}</span> : null;
  if (diff === 0)
    return (
      <>
        <span className="chip flat">–</span>
        {vsEl}
      </>
    );
  const up = diff > 0;
  return (
    <>
      <span className={cn("chip", up ? "up" : "down")}>
        <Icon name={up ? "up" : "down"} size={11} stroke={2.2} />
        {text}
      </span>
      {vsEl}
    </>
  );
}

/** Top three: an outline trophy (gold), medal (silver), medal (bronze); else an empty slot of the same size. */
export function Medal({ rank, size = 18 }: { rank: number; size?: number }) {
  const style = { ["--medal" as string]: `${size}px` };
  if (!(rank >= 1 && rank <= 3)) return <span className="medal none" style={style} aria-hidden />;
  return (
    <span className={cn("medal", `g${rank}`)} style={style} title={["First place", "Second place", "Third place"][rank - 1]}>
      <Icon name={rank === 1 ? "trophy" : "medal"} size={size} stroke={2} />
    </span>
  );
}

/** A count in a small accent pill (Approvals); nothing at 0. */
export function CountBadge({ n, label = "waiting" }: { n: number; label?: string }) {
  if (!n) return null;
  return (
    <span className="badge num" aria-label={`${n} ${label}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

// ---------------------------------------------------------------- segmented control (links)

/**
 * The segmented control as links (Me | My team | Agency, Agents | Teams): a track, the current one a
 * pill in the page color. Server-safe; for buttons with state use <Segmented> in segmented.tsx.
 */
export function SegmentedLinks({
  items,
  current,
  label,
  small,
  full,
  className,
}: {
  items: Array<{ key: string; label: ReactNode; href: string; icon?: IconName }>;
  current: string;
  /** aria-label for the group */
  label: string;
  small?: boolean;
  full?: boolean;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("seg", small && "seg-sm", full && "seg-full", className)}>
      {items.map((it) => {
        const on = it.key === current;
        return (
          <Link key={it.key} href={it.href} className={cn("seg-btn", on && "on")} aria-current={on ? "page" : undefined} scroll={false}>
            {it.icon && <Icon name={it.icon} size={16} />}
            <span>{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------- buttons

export type BtnKind = "primary" | "secondary" | "ghost" | "quiet" | "danger" | "link";
/** The class list for a button or a link that looks like one: btn("primary", "sm"). Primary wears the gradient. */
export function btn(kind: BtnKind = "secondary", size?: "sm" | "lg", extra?: string | false) {
  return cn("btn", `btn-${kind}`, size && `btn-${size}`, extra);
}

/** A link that looks like a button (the gradient "Log a sale", "Export CSV"). */
export function ButtonLink({
  kind = "secondary",
  size,
  icon,
  full,
  className,
  children,
  ...props
}: ComponentProps<typeof Link> & { kind?: BtnKind; size?: "sm" | "lg"; icon?: IconName; full?: boolean }) {
  return (
    <Link {...props} className={btn(kind, size, cn(full && "btn-full", className))}>
      {icon && <Icon name={icon} size={size === "sm" ? 16 : 18} />}
      {children != null && <span>{children}</span>}
    </Link>
  );
}

// ---------------------------------------------------------------- forms (AgentSpace's style)

/**
 * A form field: the label above (500, with a coral "*" when required), the control, then help or
 * the error. `locked` shows a lock and the reason under the control (pass the control disabled).
 */
export function Field({
  label,
  htmlFor,
  required,
  help,
  error,
  locked,
  span2,
  className,
  children,
}: {
  label?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  help?: ReactNode;
  error?: ReactNode;
  locked?: boolean | string;
  /** Take both columns of a FormGrid. */
  span2?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("field", span2 && "span-2", error ? "has-error" : false, locked && "locked", className)}>
      {label != null && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {required && (
            <span className="req" aria-hidden>
              *
            </span>
          )}
          {locked && (
            <span className="lock-ico" aria-hidden>
              <Icon name="lock" size={13} />
            </span>
          )}
        </label>
      )}
      {children}
      {typeof locked === "string" && locked && (
        <p className="lock-note">
          <Icon name="lock" size={12} />
          <span>{locked}</span>
        </p>
      )}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : help ? (
        <p className="field-help">{help}</p>
      ) : null}
    </div>
  );
}

/** The filled input (no border, radius 10, 44px tall). */
export function TextInput({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cn("input", className)} />;
}

/** A "$" box (the value is the typed text, e.g. "94.58"). */
export function MoneyInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <div className={cn("money-wrap", props.disabled && "is-disabled")}>
      <span className="money-sign" aria-hidden>
        $
      </span>
      <input inputMode="decimal" {...props} type="text" className={cn("input", className)} />
    </div>
  );
}

/** A date box with our calendar icon at the left (the browser's own picker covers the box). */
export function DateInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const empty = props.value === "" || (props.value === undefined && !props.defaultValue);
  return (
    <div className={cn("date-wrap", props.disabled && "is-disabled", empty && "is-empty")}>
      <span className="date-ico" aria-hidden>
        <Icon name="calendar" size={16} />
      </span>
      <input {...props} type="date" className={cn("input", className)} />
    </div>
  );
}

/** A select with the chevron. `small` is the 30px one for table tools. */
export function SelectBox({ className, small, children, ...props }: ComponentProps<"select"> & { small?: boolean }) {
  return (
    <div className={cn("select-wrap", small && "select-sm", props.disabled && "is-disabled")}>
      <select {...props} className={cn("select", className)}>
        {children}
      </select>
      <span className="select-chev" aria-hidden>
        <Icon name="chevron-down" size={small ? 14 : 16} />
      </span>
    </div>
  );
}

export function TextArea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cn("textarea", className)} />;
}

/** A checkbox with its words (and an optional help line). */
export function CheckBox({ label, help, className, ...props }: Omit<ComponentProps<"input">, "type"> & { label: ReactNode; help?: ReactNode }) {
  return (
    <label className={cn("check", props.disabled && "is-disabled", className)}>
      <input {...props} type="checkbox" className="check-box" />
      <span className="check-text">
        <span className="check-label">{label}</span>
        {help && <span className="check-help">{help}</span>}
      </span>
    </label>
  );
}

/** A search box with the magnifier (pair it with your own clear button when you need one). */
export function SearchInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <div className="search-wrap">
      <span className="search-ico" aria-hidden>
        <Icon name="search" size={17} />
      </span>
      <input autoComplete="off" {...props} type="search" className={cn("input search-input", className)} />
    </div>
  );
}

/** A form section: a title (and line) over its fields, a hairline between sections. */
export function FormSection({ title, sub, right, className, children }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("form-section", className)}>
      <div className="form-section-head">
        <div>
          <h3 className="form-section-title">{title}</h3>
          {sub && <p className="form-section-sub">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Two columns of fields on a wide screen, one on a phone (a Field with span2 takes both). */
export function FormGrid({ one, className, children }: { one?: boolean; className?: string; children: ReactNode }) {
  return <div className={cn("form-grid", one && "cols-1", className)}>{children}</div>;
}

// ---------------------------------------------------------------- data display

/** Label / value pairs in a grid (4 columns wide by default, 2 on a phone). */
export function DataList({ items, cols = 4, className }: { items: Array<{ label: ReactNode; value: ReactNode; dim?: boolean; span?: 2 | 4 } | null | false>; cols?: number; className?: string }) {
  return (
    <dl className={cn("dl", className)} style={{ ["--dl-cols" as string]: cols }}>
      {items.filter(Boolean).map((it, i) => {
        const item = it as { label: ReactNode; value: ReactNode; dim?: boolean; span?: 2 | 4 };
        return (
          <div key={i} className={cn("dl-item", item.span && `span-${item.span}`)}>
            <dt className="dl-label">{item.label}</dt>
            <dd className={cn("dl-value", item.dim && "dim")}>{item.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** History: a dotted line of what happened, in the order given (newest first is the caller's choice). */
export function Timeline({ items }: { items: Array<{ key?: string | number; what: ReactNode; meta?: ReactNode }> }) {
  return (
    <ol className="timeline">
      {items.map((it, i) => (
        <li key={it.key ?? i} className="tl-item">
          <span className="tl-dot" aria-hidden />
          <div className="tl-what">{it.what}</div>
          {it.meta && <div className="tl-meta">{it.meta}</div>}
        </li>
      ))}
    </ol>
  );
}

/**
 * A hairline list row: lead (an avatar), title over sub, the amount (or any right side) over a
 * small line, a chevron. With `href` the row is a link. Rows go inside <div className="list">.
 */
export function ListRow({
  title,
  sub,
  right,
  rightSub,
  lead,
  trail,
  href,
  chevron,
  wrap,
  className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  rightSub?: ReactNode;
  lead?: ReactNode;
  trail?: ReactNode;
  href?: string;
  chevron?: boolean;
  /** Let the title and sub wrap instead of cutting them with "…". */
  wrap?: boolean;
  className?: string;
}) {
  const one = wrap ? "wrap-text" : "ell";
  const inner = (
    <>
      {lead && <span className="lr-lead">{lead}</span>}
      <span className="lr-main">
        <span className={cn("lr-title", one)}>{title}</span>
        {sub != null && <span className={cn("lr-sub", one)}>{sub}</span>}
      </span>
      {(right != null || rightSub != null) && (
        <span className="lr-right">
          {right != null && <span className="lr-amt num">{right}</span>}
          {rightSub != null && <span className="lr-rsub num">{rightSub}</span>}
        </span>
      )}
      {trail}
      {chevron && (
        <span className="lr-chev" aria-hidden>
          <Icon name="chevron-right" size={16} />
        </span>
      )}
    </>
  );
  if (href)
    return (
      <Link href={href} className={cn("list-row is-action", className)}>
        {inner}
      </Link>
    );
  return <div className={cn("list-row", className)}>{inner}</div>;
}

/** A quiet empty state: an icon tile, a title, a line, an action. */
export function EmptyState({ icon, title, body, action, className }: { icon?: IconName; title: ReactNode; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("empty", className)}>
      {icon && (
        <span className="empty-ico">
          <Icon name={icon} size={22} />
        </span>
      )}
      <div className="empty-title">{title}</div>
      {body && <div className="empty-body">{body}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

/** The person's initials in a circle (the demo's .avatar; `small` is 28px). */
export function Initials({ name, small, className }: { name: string; small?: boolean; className?: string }) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const text = words.length === 0 ? "?" : words.length === 1 ? words[0].slice(0, 2).toUpperCase() : (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return (
    <span className={cn("avatar", small && "sm", className)} aria-hidden>
      {text}
    </span>
  );
}

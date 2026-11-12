"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { Icon } from "@/components/ui/icon";

/**
 * The demo's table (.tbl): a sticky header on the raised color (13px, secondary text), hairline
 * rows, right-aligned number columns in tabular figures. Wide tables scroll sideways inside their
 * own box (never the page). Sorting is the caller's: pass `sort` and `onSort`, and the header shows
 * the arrows and cycles ↓ (desc) → ↑ (asc) → cleared through `nextSort`. A row with `rowHref` opens
 * that address on a click or Enter.
 */
export interface Column<R> {
  key: string;
  label: ReactNode;
  /** Right-aligned and tabular (money, counts). */
  right?: boolean;
  /** Default true when the table has onSort. */
  sortable?: boolean;
  width?: string;
  cell: (row: R) => ReactNode;
  className?: string;
  /** Hide the column under this width (e.g. "md" hides it on a phone and a small tablet). */
  hideBelow?: "sm" | "md" | "lg" | "xl";
}

export type SortState = { by: string | null; dir: "asc" | "desc" | null };

/** The click order on a header: ↓ (desc) → ↑ (asc) → cleared (fallback). */
export function nextSort(sort: SortState, col: string, fallback: SortState = { by: null, dir: null }): SortState {
  if (sort.by !== col) return { by: col, dir: "desc" };
  if (sort.dir === "desc") return { by: col, dir: "asc" };
  return fallback;
}

const HIDE: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = {
  sm: "max-sm:hidden",
  md: "max-md:hidden",
  lg: "max-lg:hidden",
  xl: "max-xl:hidden",
};

export function DataTable<R>({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  rowHref,
  empty = "Nothing here.",
  maxHeight,
  label,
  className,
  rowClassName,
}: {
  columns: Array<Column<R>>;
  rows: R[];
  rowKey: (row: R) => string;
  sort?: SortState;
  onSort?: (col: string) => void;
  rowHref?: (row: R) => string | null;
  empty?: ReactNode;
  /** Scroll inside the box with a sticky header past this height ("640px"). */
  maxHeight?: string;
  /** aria-label of the table */
  label?: string;
  className?: string;
  rowClassName?: (row: R) => string | undefined;
}) {
  const router = useRouter();
  const open = (href: string | null | undefined) => {
    if (href) router.push(href);
  };
  return (
    <div className={cn("tbl-wrap", maxHeight && "tbl-scroll", className)} style={maxHeight ? { maxHeight } : undefined}>
      <table className="tbl" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => {
              const can = (c.sortable ?? true) && !!onSort;
              const on = sort?.by === c.key && !!sort.dir;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(c.right && "r", on && "is-sorted", c.hideBelow && HIDE[c.hideBelow])}
                  style={c.width ? { width: c.width } : undefined}
                  aria-sort={can ? (on ? (sort?.dir === "asc" ? "ascending" : "descending") : "none") : undefined}
                >
                  {can ? (
                    <button type="button" className="th-btn" onClick={() => onSort?.(c.key)}>
                      <span>{c.label}</span>
                      <Icon name={on ? (sort?.dir === "asc" ? "sort-up" : "sort-down") : "sort"} size={14} className={on ? "sort-on" : "sort-idle"} />
                    </button>
                  ) : (
                    <span className="th-text">{c.label}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="tbl-empty">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const href = rowHref?.(r) ?? null;
              return (
                <tr
                  key={rowKey(r)}
                  className={cn(href && "is-action", rowClassName?.(r))}
                  tabIndex={href ? 0 : undefined}
                  onClick={href ? (e) => (e.target as HTMLElement).closest("a,button,input,select,label") || open(href) : undefined}
                  onKeyDown={href ? (e: KeyboardEvent) => e.key === "Enter" && e.target === e.currentTarget && open(href) : undefined}
                  data-href={href ?? undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn(c.right && "r num", c.className, c.hideBelow && HIDE[c.hideBelow])}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

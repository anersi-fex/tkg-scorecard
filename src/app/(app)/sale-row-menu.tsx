"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { Role } from "@/lib/session";
import type { FeedSale } from "@/lib/board";
import { formatMoney } from "@/lib/money";
import { Icon } from "@/components/ui/icon";
import { removeSale } from "./sale-actions";
import { toast } from "@/components/toaster";

const UNDO_WINDOW_MS = 15 * 60 * 1000;

/**
 * Whether this viewer may take this sale back while it is fresh (the server decides again on the
 * tap): "ok" for a person on their own sale (or one they logged); "not-yours" for someone else's
 * sale; "view-only" for the shared team password, which never changes a sale (contract decision 2).
 */
export type UndoRight = "ok" | "not-yours" | "view-only";

/**
 * The "…" at the end of a sale row on Home. "Open the policy" goes to /policies/<id> when the
 * viewer may see it (their own, their confirmed team's for someone above the seller, anyone's for
 * an admin: pass `canOpen`, which defaults to an admin or the seller's own row). An admin also gets
 * "Fix this sale" (the policy page, its Policy section open) and Remove; a person takes back their
 * own sale in the first 15 minutes. Every rule is checked again on the server.
 *
 * Props are the earlier ones (agents, carriers, pcCarriers and pcEnabled are accepted and no
 * longer used: fixing happens on the policy page), plus `canOpen`.
 */
export function SaleRowMenu({
  sale,
  role,
  undo = "ok",
  canOpen,
}: {
  sale: FeedSale;
  /** "owner" for the owner and an admin (rules: isAdmin), "team" for everyone else. */
  role: Role;
  undo?: UndoRight;
  agents?: Array<{ id: string; name: string }>;
  carriers?: string[];
  pcCarriers?: string[];
  pcEnabled?: boolean;
  /** The viewer may open this policy (rules.ts canSeeClient); default: an admin, or their own row. */
  canOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const wrap = useRef<HTMLDivElement | null>(null);
  // Whether the sale can still be taken back, checked when the menu opens (a clock in render is impure).
  const [fresh, setFresh] = useState(true);
  const admin = role === "owner";
  const canRemove = admin || (fresh && undo === "ok");
  const opens = canOpen ?? (admin || undo === "ok");
  const href = `/policies/${sale.id}?back=home`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const remove = () => {
    if (!window.confirm(`${admin ? "Remove" : "Take back"} ${sale.agentName}'s ${formatMoney(sale.premiumCents)} sale?`)) return;
    start(async () => {
      const r = await removeSale(sale.id);
      toast(r.ok ? (r.message ?? "Removed.") : r.error, r.ok);
      setOpen(false);
    });
  };

  return (
    <div ref={wrap} className="pop-wrap shrink-0" data-sale-menu={sale.id}>
      <button
        type="button"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setFresh(Date.now() - new Date(sale.createdAt).getTime() < UNDO_WINDOW_MS);
          setOpen((v) => !v);
        }}
        className="btn btn-ghost btn-icon btn-sm"
      >
        <Icon name="more" size={18} />
      </button>
      {open && (
        <div className="pop pop-right" style={{ width: 220 }} role="menu">
          <div className="menu">
            {opens && (
              <Link href={href} role="menuitem" className="menu-item" onClick={() => setOpen(false)}>
                <Icon name="file" size={17} />
                <span className="menu-label">Open the policy</span>
              </Link>
            )}
            {admin && (
              <Link href={`/policies/${sale.id}?edit=policy&back=home`} role="menuitem" className="menu-item" onClick={() => setOpen(false)}>
                <Icon name="pencil" size={17} />
                <span className="menu-label">Fix this sale</span>
              </Link>
            )}
            {canRemove ? (
              <button type="button" role="menuitem" disabled={pending} onClick={remove} className="menu-item danger">
                <Icon name={admin ? "trash" : "undo"} size={17} />
                <span className="menu-label">{pending ? "Removing..." : admin ? "Remove" : "Undo (just logged)"}</span>
              </button>
            ) : (
              <p data-undo={undo} className="px-3 py-2 text-[13px] leading-snug text-fg-2">
                {undo === "view-only" ? "The team password only looks." : undo === "not-yours" ? "You can take back your own sales only. Ask an admin about this one." : "Only an admin can remove a sale after 15 minutes."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

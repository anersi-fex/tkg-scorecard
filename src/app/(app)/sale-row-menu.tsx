"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Role } from "@/lib/session";
import type { FeedSale } from "@/lib/board";
import { formatMoney } from "@/lib/money";
import { editSale, removeSale } from "./actions";
import { toast } from "@/components/toaster";
import { Button, Input, Label, Select, cn } from "@/components/ui";

const UNDO_WINDOW_MS = 15 * 60 * 1000;

/**
 * The "…" at the end of a sale row: the owner can fix or remove any sale; the team can take back
 * one logged in the last 15 minutes.
 */
export function SaleRowMenu({ sale, role, agents }: { sale: FeedSale; role: Role; agents: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const wrap = useRef<HTMLDivElement | null>(null);
  // Whether the team can still take this one back, checked when the menu opens (a clock in render is impure).
  const [fresh, setFresh] = useState(true);
  const canRemove = role === "owner" || fresh;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const remove = () => {
    if (!window.confirm(`Remove ${sale.agentName}'s ${formatMoney(sale.premiumCents)} sale?`)) return;
    start(async () => {
      const r = await removeSale(sale.id);
      toast(r.ok ? (r.message ?? "Removed.") : r.error, r.ok);
      setOpen(false);
    });
  };

  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        type="button"
        aria-label="More"
        aria-expanded={open}
        onClick={() => {
          setFresh(Date.now() - new Date(sale.createdAt).getTime() < UNDO_WINDOW_MS);
          setOpen((v) => !v);
        }}
        className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-gray-500 hover:bg-gray-50 hover:text-gray-900"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full right-0 z-20 w-44 rounded-2xl bg-surface p-1.5 shadow-float">
          {role === "owner" && (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setOpen(false);
              }}
              className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-[14px] font-semibold text-gray-900 hover:bg-gray-50"
            >
              Fix this sale
            </button>
          )}
          {canRemove ? (
            <button type="button" disabled={pending} onClick={remove} className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-[14px] font-semibold text-red-700 hover:bg-red-50">
              {pending ? "Removing..." : role === "owner" ? "Remove" : "Undo (just logged)"}
            </button>
          ) : (
            <p className="px-3 py-2 text-[13px] leading-snug text-gray-500">Only Anersi can remove a sale after 15 minutes.</p>
          )}
        </div>
      )}
      {editing && <EditSheet sale={sale} agents={agents} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EditSheet({ sale, agents, onClose }: { sale: FeedSale; agents: Array<{ id: string; name: string }>; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-gray-900/40 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Fix this sale">
      <form
        action={(form) =>
          start(async () => {
            const r = await editSale(sale.id, form);
            if (r.ok) {
              toast(r.message ?? "Saved.");
              onClose();
            } else setError(r.error);
          })
        }
        className="w-full max-w-md rounded-[26px] bg-surface p-5 shadow-float"
      >
        <h2 className="text-[20px] font-extrabold tracking-[-0.02em] text-gray-900">Fix this sale</h2>
        {error && <p className="mt-2 text-[13px] text-red-700">{error}</p>}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label htmlFor="e-agent">Who</Label>
            <Select id="e-agent" name="agent_id" defaultValue={sale.agentId}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="e-premium">Annual premium</Label>
            <Input id="e-premium" name="premium" inputMode="decimal" defaultValue={(sale.premiumCents / 100).toFixed(sale.premiumCents % 100 ? 2 : 0)} className="font-mono" required />
          </div>
          <div>
            <Label htmlFor="e-policies">Policies</Label>
            <Input id="e-policies" name="policies" type="number" min={1} max={50} defaultValue={sale.policies} className="font-mono" required />
          </div>
          <div>
            <Label htmlFor="e-product">Product</Label>
            <Input id="e-product" name="product" defaultValue={sale.product ?? ""} maxLength={40} />
          </div>
          <div>
            <Label htmlFor="e-client">Client first name</Label>
            <Input id="e-client" name="client" defaultValue={sale.client ?? ""} maxLength={40} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="e-date">Day</Label>
            <Input id="e-date" name="sold_on" type="date" defaultValue={sale.soldOn} required />
          </div>
          <div className="col-span-2">
            <Label htmlFor="e-note">Note</Label>
            <Input id="e-note" name="note" defaultValue={sale.note ?? ""} maxLength={200} />
          </div>
        </div>
        <div className={cn("mt-5 flex gap-2")}>
          <Button type="button" variant="secondary" className="flex-1 rounded-2xl" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1 rounded-2xl" disabled={pending}>
            {pending ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </div>
  );
}

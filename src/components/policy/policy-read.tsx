import type { ReactNode } from "react";
import { cn } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import { formatDollars } from "@/lib/money";
import type { Beneficiary, PolicyClient, PolicyField } from "@/lib/policy-types";
import { ageOn, billingDayText, premiumText } from "@/lib/policy-validate";
import { dateLong } from "./format";

/**
 * A policy read back as label / value pairs (the demo's dl, policyItems and clientItems): Log a
 * sale's review and the policy page. Server-safe. A locked field carries a small lock beside its
 * label with the reason as its title.
 */
export interface ReadItem {
  label: string;
  value?: ReactNode;
  dim?: boolean;
  span?: 2 | 3 | 4;
  lock?: string | false;
}

export function PvDl({ items, cols = 4, className }: { items: ReadItem[]; cols?: number; className?: string }) {
  return (
    <dl className={cn("dl pv-dl", className)} style={{ ["--dl-cols" as string]: cols }}>
      {items.map((it, i) => {
        const cut = it.label.lastIndexOf(" ") + 1;
        const empty = it.value == null || it.value === "";
        return (
          <div key={i} className={cn("dl-item", it.span && `span-${it.span}`)}>
            <dt className="dl-label">
              {it.lock ? (
                <>
                  {it.label.slice(0, cut)}
                  <span className="pv-glue">
                    {it.label.slice(cut)}
                    <span className="pv-lock" title={it.lock} aria-label={`Locked: ${it.lock}`}>
                      <Icon name="lock" size={12} />
                    </span>
                  </span>
                </>
              ) : (
                it.label
              )}
            </dt>
            <dd className={cn("dl-value", (it.dim || empty) && "dim")}>{empty ? "—" : it.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export interface ReadPolicy {
  carrier: string | null;
  product: string | null;
  effectiveDate: string | null;
  monthlyCents: number | null;
  premiumCents: number;
  rateClass: string | null;
  coverageCents: number | null;
  soldOn: string;
  ssBenefit: boolean | null;
  billingCycle: string | null;
  billingDay: string | null;
  policyNumber: string | null;
  applicationNumber: string | null;
  leadSource: string | null;
  underwriting: boolean;
}

/** The Policy grid. `lockOf(field)` gives a locked field's reason. */
export function policyItems(s: ReadPolicy, lockOf?: (f: PolicyField) => string | false, soldBy?: string): ReadItem[] {
  const L = (f: PolicyField) => (lockOf ? lockOf(f) : false);
  const items: ReadItem[] = [
    { label: "Carrier", value: s.carrier, lock: L("carrier") },
    { label: "Product", value: s.product, lock: L("product") },
    { label: "Policy effective date", value: dateLong(s.effectiveDate), lock: L("effectiveDate") },
    { label: "Monthly premium", value: s.premiumCents ? premiumText(s.monthlyCents, s.premiumCents) : "", lock: L("monthlyCents") },
    { label: "Rate class", value: s.rateClass, lock: L("rateClass") },
    { label: "Coverage amount", value: s.coverageCents ? formatDollars(s.coverageCents) : "", lock: L("coverageCents") },
    { label: "Submitted date", value: dateLong(s.soldOn), lock: L("soldOn") },
    { label: "Paid from a Social Security benefit", value: s.ssBenefit == null ? "" : s.ssBenefit ? "Yes" : "No", lock: L("ssBenefit") },
    { label: "Billing cycle", value: s.billingCycle, lock: L("billingCycle") },
    { label: "Billing day", value: billingDayText(s.billingDay, s.billingCycle), lock: L("billingDay") },
    { label: "Policy number", value: s.policyNumber || "Not yet", dim: !s.policyNumber, lock: L("policyNumber") },
    { label: "Application number", value: s.applicationNumber, lock: L("applicationNumber") },
    { label: "Lead source", value: s.leadSource, lock: L("leadSource") },
    { label: "In underwriter review with the carrier", value: s.underwriting ? "Yes" : "No", lock: L("underwriting") },
  ];
  return soldBy != null ? [{ label: "Sold by", value: soldBy, lock: L("agentId") }, ...items] : items;
}

export function BensText({ list }: { list: Beneficiary[] }) {
  if (!list.length) return <span className="dim">None listed</span>;
  return (
    <>
      {list.map((b, i) => (
        <span key={i} className="block">
          {b.name}
          {b.relationship && <span className="muted"> ({b.relationship})</span>}
        </span>
      ))}
    </>
  );
}

/** The Client grid: on 4 columns name, birth, email (2) / phone, address (3); on 2 the email takes its own row. */
export function clientItems(c: PolicyClient, today: string, opts: { cols?: number; bens?: Beneficiary[] } = {}): ReadItem[] {
  const four = (opts.cols ?? 4) >= 4;
  const age = c.dob ? ageOn(c.dob, today) : null;
  const items: ReadItem[] = [
    { label: "Name", value: `${c.firstName} ${c.lastName}`.trim() },
    {
      label: "Date of birth",
      value: c.dob ? (
        <>
          {dateLong(c.dob)}
          {age != null && <span className="pv-age">Age {age}</span>}
        </>
      ) : (
        ""
      ),
    },
    { label: "Email", value: c.noEmail || !c.email ? "No email" : c.email, dim: c.noEmail || !c.email, span: 2 },
    { label: "Phone", value: c.phone },
    { label: "Address", value: c.address, span: four ? 3 : undefined },
  ];
  if (opts.bens) items.push({ label: "Beneficiaries", value: <BensText list={opts.bens} />, span: 4 });
  return items;
}

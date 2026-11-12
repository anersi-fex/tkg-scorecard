"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { Icon, type IconName } from "@/components/ui/icon";
import { EmptyState, PageHead, StatusPill } from "@/components/ui/kit";
import { Segmented } from "@/components/ui/segmented";
import { formatDollars } from "@/lib/money";
import { centsText, monthlyText } from "@/lib/policy-validate";
import { clearFilters, nextSort, queryToParams, viewOf, viewQuery } from "@/lib/policy-filter";
import { DEFAULT_HIDDEN_COLUMNS, DEFAULT_SORT, MULTI_FILTERS, PAGE_SIZE, POLICY_COLUMNS, POLICY_STATUSES, SAVED_VIEWS, STATUS_KEY, type MultiFilterKey, type PolicyColumn, type PolicyQuery, type PolicyScope, type PolicyStatus, type ViewId } from "@/lib/policy-types";
import type { PolicyScopeTab } from "@/lib/rules";
import { dayShort, policiesWord, shortName } from "@/components/policy/format";
import type { Option, PolicyRowView } from "@/components/policy/list-data";

/** Everything the Policies page hands the browser: the rows shown, the counts, never the whole list. */
export interface PoliciesViewProps {
  title: string;
  scopes: PolicyScopeTab[];
  scope: PolicyScope;
  teamId: string | null;
  leaders: { id: string; label: string }[];
  scopeNote: string;
  withAgent: boolean;
  managerish: boolean;
  query: PolicyQuery;
  baseCount: number;
  matched: number;
  annualCents: number;
  avgMonthlyCents: number;
  rows: PolicyRowView[];
  status: { all: number; byStatus: Record<PolicyStatus, number>; noStatus: number };
  views: Record<ViewId, number>;
  facets: Partial<Record<MultiFilterKey, Option[]>>;
  dateCounts: { sub: Record<"month" | "7d", number>; eff: Record<"month" | "next", number> };
  yesNo: { ss: { pool: number; yes: number }; benef: { pool: number; yes: number } };
}

const VIEW_ICON: Partial<Record<ViewId, IconName>> = { attention: "alert", effective: "calendar", issued: "check-circle", nonum: "flag" };
const DATES = {
  sub: { label: "Submitted", presets: [["month", "This month"], ["7d", "Last 7 days"], ["custom", "Custom"]] as const },
  eff: { label: "Effective", presets: [["month", "This month"], ["next", "Next month"], ["custom", "Custom"]] as const },
};
const SORT_CHOICES: [string, string][] = [
  ["submitted:desc", "Submitted, newest first"],
  ["submitted:asc", "Submitted, oldest first"],
  ["client:asc", "Client, A to Z"],
  ["monthly:desc", "Premium, highest first"],
  ["effective:asc", "Effective date, soonest first"],
  ["status:asc", "Status"],
  ["carrier:asc", "Carrier, A to Z"],
  ["agent:asc", "Agent, A to Z"],
];

// ---- the Columns choice: column ids only, per kind of list, in this browser ----------------------------
const COLS_KEY = "scorecard:policy-columns";
const COLS_EVENT = "scorecard:policy-columns";
function readCols(): string | null {
  try {
    return localStorage.getItem(COLS_KEY);
  } catch {
    return null;
  }
}
function subscribeCols(cb: () => void) {
  window.addEventListener(COLS_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(COLS_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
const ALL_COLUMN_IDS = POLICY_COLUMNS.map((c) => c.id);
function hiddenOf(raw: string | null, kind: "mine" | "team"): PolicyColumn[] {
  try {
    const v = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    const list = v && Array.isArray(v[kind]) ? (v[kind] as unknown[]) : null;
    if (list) return list.filter((x): x is PolicyColumn => typeof x === "string" && (ALL_COLUMN_IDS as string[]).includes(x));
  } catch {
    // a broken value: the defaults
  }
  return DEFAULT_HIDDEN_COLUMNS[kind];
}
function saveHidden(kind: "mine" | "team", list: PolicyColumn[]) {
  try {
    const v = JSON.parse(readCols() || "{}") as Record<string, unknown>;
    v[kind] = list;
    localStorage.setItem(COLS_KEY, JSON.stringify(v));
  } catch {
    // blocked storage: the choice lasts until the page reloads
  }
  window.dispatchEvent(new Event(COLS_EVENT));
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** The typed words marked inside a name (a highlight while searching). */
function hl(text: string, words: string[]): ReactNode {
  if (!words.length || !text) return text;
  const n = norm(text);
  if (n.length !== text.length) return text;
  const on = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    let i = n.indexOf(w);
    while (i >= 0) {
      for (let j = i; j < i + w.length; j++) on[j] = true;
      i = n.indexOf(w, i + 1);
    }
  }
  const out: ReactNode[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || on[i] !== on[start]) {
      const piece = text.slice(start, i);
      out.push(on[start] ? <mark key={start}>{piece}</mark> : piece);
      start = i;
    }
  }
  return out;
}

const dot = (s: PolicyStatus) => <span className={cn("pol-dot", `d-${STATUS_KEY[s]}`)} aria-hidden />;

/**
 * Policies, the CRM (the demo the owner approved): scope, the status strip, saved views, search,
 * filter menus, active-filter chips, Columns, Export CSV, a sortable table on a computer and cards
 * on a phone, 25 at a time. Every choice is in the address and applied on the server; this file
 * only draws what came back and changes the address.
 */
export function PoliciesView(p: PoliciesViewProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pop, setPop] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const q = p.query;
  const words = norm(q.q).trim().split(/\s+/).filter(Boolean);

  const go = (patch: Partial<PolicyQuery>, keepLimit = false) => {
    const next: PolicyQuery = { ...q, ...patch };
    if (!keepLimit && !("limit" in patch)) next.limit = PAGE_SIZE;
    const qs = queryToParams(next).toString();
    start(() => router.replace(qs ? `/policies?${qs}` : "/policies", { scroll: false }));
  };
  const goScope = (scope: PolicyScope) => go({ ...clearFilters({ ...q, scope }), q: q.q, scope, team: null, agent: [] });

  const kind: "mine" | "team" = p.withAgent ? "team" : "mine";
  const colsRaw = useSyncExternalStore(subscribeCols, readCols, () => null);
  const hidden = hiddenOf(colsRaw, kind);
  const cols = POLICY_COLUMNS.filter((c) => (!c.team || p.withAgent) && (c.fixed || !hidden.includes(c.id)));

  const exportHref = (() => {
    const params = queryToParams({ ...q, limit: PAGE_SIZE, scope: p.scope, team: p.teamId });
    return `/api/policies/export?${params.toString()}`;
  })();

  const nWord = (n: number) => (n === 1 ? "policy" : "policies");
  const narrowed = p.matched !== p.baseCount;
  const summary = !p.baseCount
    ? p.scope === "mine"
      ? "Nothing logged yet"
      : "0 policies"
    : !p.matched
      ? `None of ${p.baseCount} ${nWord(p.baseCount)} match`
      : `${narrowed ? `${p.matched} of ${p.baseCount}` : p.matched} ${nWord(narrowed ? p.baseCount : p.matched)} · ${formatDollars(p.annualCents)}/yr · avg ${monthlyText(p.avgMonthlyCents)}`;
  const sub = summary + (p.scopeNote ? ` · ${p.scopeNote}` : "");

  const scopeSeg =
    p.scopes.length > 1 ? (
      <Segmented<PolicyScope> className="pol-scope" label="Whose policies" items={p.scopes.map((s) => ({ key: s.id, label: s.label }))} value={p.scope} onChange={goScope} />
    ) : null;
  const teamPick = p.teamId ? (
    <div className="pol-team">
      <div className="select-wrap select-sm">
        <select className="select" aria-label="Which team" value={p.teamId} onChange={(e) => go({ team: e.target.value, scope: "team", agent: [] })}>
          {p.leaders.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <span className="select-chev" aria-hidden>
          <Icon name="chevron-down" size={14} />
        </span>
      </div>
    </div>
  ) : null;
  const head = (
    <PageHead
      title={p.title}
      sub={sub}
      right={
        scopeSeg || teamPick ? (
          <div className="pol-scopes">
            {scopeSeg}
            {teamPick}
          </div>
        ) : undefined
      }
    />
  );

  if (!p.baseCount) {
    const mine = p.scope === "mine";
    return (
      <div className="page pol-page" data-policies>
        {head}
        <section className="card pol-empty">
          <EmptyState
            icon="file"
            title="No policies yet"
            body={mine ? "Your sales show up here with their clients, status and dates, the moment you log them." : "When these people log sales, the policies show up here."}
            action={
              mine ? (
                <Link href="/log" className="btn btn-primary">
                  <Icon name="plus" size={18} />
                  <span>Log a sale</span>
                </Link>
              ) : undefined
            }
          />
        </section>
      </div>
    );
  }

  const nActive = activeCount(q);
  const listEmpty = !p.matched ? (
    <div className="pol-none">
      <EmptyState
        icon="search"
        title="No policies match."
        body={words.length ? `Nothing fits "${q.q}"${nActive ? " with these filters" : ""}.` : "Nothing fits these filters."}
        action={
          <button type="button" className="btn btn-secondary" onClick={() => go({ ...clearFilters(q), q: words.length && !nActive ? "" : q.q })}>
            {words.length && !nActive ? "Clear the search" : "Clear the filters"}
          </button>
        }
      />
    </div>
  ) : null;
  const shown = p.rows.length;
  const more =
    p.matched > shown ? (
      <div className="pol-foot">
        <span className="pol-foot-n num">
          Showing {shown} of {p.matched}
        </span>
        <span className="pol-foot-btns">
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => go({ limit: q.limit + PAGE_SIZE }, true)}>
            <span>Show {Math.min(PAGE_SIZE, p.matched - shown)} more</span>
            <Icon name="chevron-down" size={16} />
          </button>
          {p.matched - shown > PAGE_SIZE && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => go({ limit: 100_000 }, true)}>
              Show all
            </button>
          )}
        </span>
      </div>
    ) : p.matched > PAGE_SIZE ? (
      <div className="pol-foot">
        <span className="pol-foot-n num">All {p.matched} shown</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => go({ limit: PAGE_SIZE }, true)}>
          <span>Show fewer</span>
          <Icon name="chevron-up" size={16} />
        </button>
      </div>
    ) : null;

  return (
    <div className={cn("page pol-page", pending && "is-pending")} data-policies data-scope={p.scope}>
      {head}
      <div className="pol-ptools only-phone">
        <SearchBox value={q.q} placeholder={p.managerish ? "Client, agent or policy #" : "Name, phone or policy #"} onSearch={(v) => go({ q: v })} id="pol-q-phone" />
        <button type="button" className={cn("btn btn-secondary pol-fbtn", nActive > 0 && "is-on")} onClick={() => setSheet(true)}>
          <Icon name="filter" size={18} />
          <span>{nActive ? `Filters (${nActive})` : "Filters"}</span>
        </button>
      </div>
      <StatusStrip p={p} go={go} />
      <ViewsRow p={p} go={go} />
      <div className="pol-toolbar only-wide">
        <div className="pol-search">
          <SearchBox
            value={q.q}
            id="pol-q"
            placeholder={p.managerish ? "Search client, agent, phone, email, policy or app number" : "Search client, phone, email, policy or app number"}
            onSearch={(v) => go({ q: v })}
          />
        </div>
        <div className="pol-tools">
          <Pop
            id="cols"
            open={pop === "cols"}
            setOpen={(o) => setPop(o ? "cols" : null)}
            align="right"
            width={250}
            anchor={
              <>
                <Icon name="columns" size={16} className="ico" />
                <span>Columns</span>
              </>
            }
            anchorClass="pol-tool"
          >
            <div className="pol-pf">
              <div className="pol-pf-head">
                <span className="pol-pf-title">Columns</span>
                {hidden.length > 0 && (
                  <button type="button" className="link" onClick={() => saveHidden(kind, [])}>
                    Show all
                  </button>
                )}
              </div>
              <div className="pol-pf-list">
                {POLICY_COLUMNS.filter((c) => !c.team || p.withAgent).map((c) => (
                  <label key={c.id} className={cn("pol-opt", c.fixed && "is-fixed")}>
                    <input type="checkbox" className="check-box" checked={!hidden.includes(c.id)} disabled={c.fixed} onChange={() => saveHidden(kind, hidden.includes(c.id) ? hidden.filter((x) => x !== c.id) : [...hidden, c.id])} />
                    <span className="pol-opt-l">{c.label}</span>
                    {c.fixed && <span className="pol-opt-n">Always</span>}
                  </label>
                ))}
              </div>
              <p className="pol-pf-note">Remembered in this browser{p.withAgent ? " for team lists" : " for your own list"}.</p>
            </div>
          </Pop>
          <a className="pol-fb pol-tool" href={exportHref} download data-export>
            <Icon name="download" size={16} className="ico" />
            <span>Export CSV</span>
          </a>
        </div>
        <div className="pol-fbs" role="group" aria-label="Filters">
          {MULTI_FILTERS.filter((f) => !f.more && (!f.team || p.withAgent)).map((f) => (
            <Pop key={f.key} id={f.key} open={pop === f.key} setOpen={(o) => setPop(o ? f.key : null)} width={f.key === "agent" ? 290 : 260} n={q[f.key].length} anchor={<span>{f.key === "agent" ? "Sold by" : f.label}</span>}>
              <MultiBody label={f.key === "agent" ? "Sold by" : f.label} k={f.key} options={p.facets[f.key] ?? []} selected={q[f.key]} go={go} />
            </Pop>
          ))}
          {(["sub", "eff"] as const).map((k) => (
            <Pop key={k} id={k} open={pop === k} setOpen={(o) => setPop(o ? k : null)} width={290} n={q[k] ? 1 : 0} anchor={<span>{DATES[k].label}</span>}>
              <DateBody k={k} p={p} go={go} />
            </Pop>
          ))}
          <Pop id="more" open={pop === "more"} setOpen={(o) => setPop(o ? "more" : null)} width={320} n={(q.ss ? 1 : 0) + (q.benef ? 1 : 0) + (q.cycle.length ? 1 : 0) + (q.nonum ? 1 : 0)} anchor={<span>More</span>}>
            <MoreBody p={p} go={go} />
          </Pop>
        </div>
      </div>
      <ActiveChips p={p} go={go} />
      {listEmpty ? (
        <section className="card pol-card">{listEmpty}</section>
      ) : (
        <>
          <section className="card pol-card only-wide" aria-label={p.title}>
            <Table p={p} cols={cols} words={words} onSort={(c) => go({ sort: nextSort(q.sort, c) }, true)} />
            {more}
          </section>
          <div className="only-phone">
            <div className="pol-cards">
              {p.rows.map((r) => (
                <Link key={r.id} href={`/policies/${r.id}`} className="card pol-cardrow" data-policy={r.id}>
                  <span className="pol-cr-top">
                    <span className="pol-cr-name">{hl(r.client || "No client yet", words)}</span>
                    {r.isImport ? <span className="pill sm">{policiesWord(r.policies)}</span> : <StatusPill status={r.status} small />}
                  </span>
                  <span className="pol-cr-line">
                    {[r.carrier, r.product].filter(Boolean).join(" · ") || (r.isImport ? "No carrier" : "")}
                    {r.staleDays > 0 && (
                      <span className="pol-stale">
                        <Icon name="clock" size={12} />
                        {r.staleDays}d
                      </span>
                    )}
                  </span>
                  <span className="pol-cr-foot">
                    <span className="pol-cr-amt num">{r.monthlyCents ? monthlyText(r.monthlyCents) : `${formatDollars(r.premiumCents)}/yr`}</span>
                    <span className="pol-cr-day">Submitted {dayShort(r.soldOn)}</span>
                  </span>
                  {p.withAgent && (
                    <span className="pol-cr-agent">
                      <Icon name="user" size={13} />
                      {hl(r.agentName, words)}
                    </span>
                  )}
                </Link>
              ))}
            </div>
            {more}
          </div>
        </>
      )}
      {sheet && <FilterSheet p={p} go={go} onClose={() => setSheet(false)} />}
    </div>
  );
}

function activeCount(q: PolicyQuery): number {
  let n = 0;
  for (const f of MULTI_FILTERS) if (q[f.key].length) n++;
  for (const k of ["sub", "eff", "ss", "benef"] as const) if (q[k]) n++;
  if (q.stale) n++;
  if (q.nonum) n++;
  return n;
}

type Go = (patch: Partial<PolicyQuery>, keepLimit?: boolean) => void;

/** The search box: the address changes a moment after the typing stops. */
function SearchBox({ value, placeholder, onSearch, id }: { value: string; placeholder: string; onSearch: (v: string) => void; id: string }) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  // The address changed elsewhere (Clear all): the box follows it.
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const send = (v: string, wait: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearch(v), wait);
  };
  return (
    <div className="search-wrap">
      <span className="search-ico" aria-hidden>
        <Icon name="search" size={17} />
      </span>
      <input
        id={id}
        type="search"
        className="input search-input"
        placeholder={placeholder}
        aria-label="Search policies"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          send(e.target.value, 300);
        }}
        onKeyDown={(e) => e.key === "Enter" && send(text, 0)}
      />
      {text && (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear the search"
          onClick={() => {
            setText("");
            send("", 0);
          }}
        >
          <Icon name="close" size={15} />
        </button>
      )}
    </div>
  );
}

/** A filter button and its menu (closes on a click outside or Escape). */
function Pop({ id, open, setOpen, anchor, anchorClass, n = 0, width = 260, align = "left", children }: { id: string; open: boolean; setOpen: (o: boolean) => void; anchor: ReactNode; anchorClass?: string; n?: number; width?: number; align?: "left" | "right"; children: ReactNode }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const [side, setSide] = useState<"left" | "right">(align);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, setOpen]);
  return (
    <div className="pop-wrap" ref={wrap} data-filter={id}>
      <button
        type="button"
        className={cn("pol-fb", anchorClass, n > 0 && "is-on", open && "open")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          // A menu near the right edge opens leftward instead of being cut off.
          if (!open && align === "left" && wrap.current) setSide(wrap.current.getBoundingClientRect().left + width > window.innerWidth - 16 ? "right" : "left");
          setOpen(!open);
        }}
      >
        {anchor}
        {n > 0 && <span className="pol-fb-n num">{n}</span>}
        {!anchorClass && <Icon name="chevron-down" size={15} className="pol-fb-chev" />}
      </button>
      {open && (
        <div className={cn("pop pol-pop", side === "right" ? "pop-right" : "pop-left")} style={{ width }} role="dialog">
          {children}
        </div>
      )}
    </div>
  );
}

function MultiBody({ label, k, options, selected, go }: { label: string; k: MultiFilterKey; options: Option[]; selected: string[]; go: Go }) {
  const [aq, setAq] = useState("");
  const w = norm(aq).trim().split(/\s+/).filter(Boolean);
  const list = w.length ? options.filter((o) => w.every((x) => norm(o.label).includes(x))) : options;
  const toggle = (v: string) => go({ [k]: selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v] } as Partial<PolicyQuery>);
  return (
    <div className="pol-pf">
      <div className="pol-pf-head">
        <span className="pol-pf-title">{label}</span>
        {selected.length > 0 && (
          <button type="button" className="link" onClick={() => go({ [k]: [] } as Partial<PolicyQuery>)}>
            Clear
          </button>
        )}
      </div>
      {k === "agent" && options.length > 8 && (
        <div className="pol-pf-search">
          <input type="search" className="input" placeholder="Find a person" aria-label="Find a person" value={aq} onChange={(e) => setAq(e.target.value)} autoComplete="off" />
        </div>
      )}
      <div className="pol-pf-list">
        {list.length === 0 && <p className="pol-pf-none">No one by that name.</p>}
        {list.map((o) => (
          <label key={o.value} className={cn("pol-opt", !o.n && "zero")}>
            <input type="checkbox" className="check-box" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
            <span className="pol-opt-l">
              {k === "status" && (POLICY_STATUSES as readonly string[]).includes(o.value) && dot(o.value as PolicyStatus)}
              {o.label}
            </span>
            <span className="pol-opt-n num">{o.n}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function DateBody({ k, p, go }: { k: "sub" | "eff"; p: PoliciesViewProps; go: Go }) {
  const q = p.query;
  const cur = q[k];
  const from = k === "sub" ? q.subFrom : q.effFrom;
  const to = k === "sub" ? q.subTo : q.effTo;
  const counts = p.dateCounts[k] as Record<string, number>;
  const set = (preset: string | null) => go(k === "sub" ? { sub: (preset as PolicyQuery["sub"]) ?? null } : { eff: (preset as PolicyQuery["eff"]) ?? null });
  const edge = (which: "From" | "To", v: string) => go({ [`${k}${which}`]: v } as Partial<PolicyQuery>);
  return (
    <div className="pol-pf">
      <div className="pol-pf-head">
        <span className="pol-pf-title">{DATES[k].label}</span>
        {cur && (
          <button type="button" className="link" onClick={() => go({ [k]: null, [`${k}From`]: "", [`${k}To`]: "" } as Partial<PolicyQuery>)}>
            Clear
          </button>
        )}
      </div>
      <div className="pol-pf-list" role="radiogroup" aria-label={DATES[k].label}>
        {DATES[k].presets.map(([id, label]) => {
          const on = cur === id;
          return (
            <button key={id} type="button" role="radio" aria-checked={on} className={cn("pol-opt pol-radio", on && "on")} onClick={() => set(on ? null : id)}>
              <span className="pol-radio-dot" aria-hidden />
              <span className="pol-opt-l">{label}</span>
              {id !== "custom" && <span className="pol-opt-n num">{counts[id] ?? 0}</span>}
            </button>
          );
        })}
      </div>
      {cur === "custom" && (
        <div className="pol-pf-range">
          <div className="field">
            <label className="field-label" htmlFor={`pol-${k}-from`}>
              From
            </label>
            <input id={`pol-${k}-from`} type="date" className="input" value={from} max={to || undefined} onChange={(e) => edge("From", e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`pol-${k}-to`}>
              To
            </label>
            <input id={`pol-${k}-to`} type="date" className="input" value={to} min={from || undefined} onChange={(e) => edge("To", e.target.value)} />
          </div>
        </div>
      )}
    </div>
  );
}

function MoreBody({ p, go }: { p: PoliciesViewProps; go: Go }) {
  const q = p.query;
  const tri = (k: "ss" | "benef", label: string, yes: string, no: string) => {
    const c = p.yesNo[k];
    return (
      <div className="pol-pf-group">
        <div className="pol-pf-sub">{label}</div>
        <Segmented<"" | "yes" | "no">
          small
          full
          label={label}
          value={q[k] ?? ""}
          onChange={(v) => go({ [k]: v || null } as Partial<PolicyQuery>)}
          items={[
            { key: "", label: "Any" },
            { key: "yes", label: `${yes} · ${c.yes}` },
            { key: "no", label: `${no} · ${c.pool - c.yes}` },
          ]}
        />
      </div>
    );
  };
  const any = q.ss || q.benef || q.cycle.length || q.nonum;
  const cycles = p.facets.cycle ?? [];
  return (
    <div className="pol-pf">
      <div className="pol-pf-head">
        <span className="pol-pf-title">More filters</span>
        {any ? (
          <button type="button" className="link" onClick={() => go({ ss: null, benef: null, cycle: [], nonum: false })}>
            Clear
          </button>
        ) : null}
      </div>
      {tri("ss", "Social Security billing", "Yes", "No")}
      {tri("benef", "Beneficiaries", "Has some", "None")}
      <div className="pol-pf-group">
        <div className="pol-pf-sub">Billing cycle</div>
        <div className="pol-pf-list">
          {cycles.map((o) => (
            <label key={o.value} className={cn("pol-opt", !o.n && "zero")}>
              <input type="checkbox" className="check-box" checked={q.cycle.includes(o.value)} onChange={() => go({ cycle: q.cycle.includes(o.value) ? q.cycle.filter((x) => x !== o.value) : [...q.cycle, o.value] })} />
              <span className="pol-opt-l">{o.label}</span>
              <span className="pol-opt-n num">{o.n}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="pol-pf-group">
        <div className="pol-pf-sub">Policy number</div>
        <label className="pol-opt">
          <input type="checkbox" className="check-box" checked={q.nonum} onChange={() => go({ nonum: !q.nonum })} />
          <span className="pol-opt-l">Missing a policy number</span>
          <span className="pol-opt-n num">{p.views.nonum}</span>
        </label>
      </div>
    </div>
  );
}

function StatusStrip({ p, go }: { p: PoliciesViewProps; go: Go }) {
  const sel = p.query.status;
  const chip = (s: PolicyStatus | "all", label: string, n: number, on: boolean) => (
    <button key={s} type="button" className={cn("pol-sc", on && "on", !n && "zero")} aria-pressed={on} onClick={() => go({ status: s === "all" ? [] : sel.length === 1 && sel[0] === s ? [] : [s] })}>
      {s !== "all" && dot(s)}
      <span>{label}</span>
      <span className="pol-sc-n num">{n}</span>
    </button>
  );
  return (
    <div className="pol-strip" role="group" aria-label="Filter by status">
      {chip("all", "All", p.status.all, !sel.length)}
      {POLICY_STATUSES.map((s) => chip(s, s, p.status.byStatus[s] ?? 0, sel.includes(s)))}
    </div>
  );
}

function ViewsRow({ p, go }: { p: PoliciesViewProps; go: Go }) {
  const on = viewOf(p.query);
  return (
    <div className="pol-views" role="group" aria-label="Saved views">
      <span className="pol-views-l">Views</span>
      {SAVED_VIEWS.map((v) => {
        const n = p.views[v.id] ?? 0;
        const isOn = on === v.id;
        const icon = VIEW_ICON[v.id];
        return (
          <button
            key={v.id}
            type="button"
            className={cn("pol-vw", isOn && "on", v.id === "attention" && n > 0 && "warn", v.id === "all" && "only-wide")}
            aria-pressed={isOn}
            title={v.title}
            onClick={() => go(viewQuery(isOn && v.id !== "all" ? "all" : v.id, p.query))}
          >
            {icon && <Icon name={icon} size={14} className="ico" />}
            <span>{v.label}</span>
            <span className="pol-vw-n num">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

function ActiveChips({ p, go }: { p: PoliciesViewProps; go: Go }) {
  const q = p.query;
  const chips: { key: string; text: string; clear: Partial<PolicyQuery> }[] = [];
  const label = (k: MultiFilterKey, v: string) => p.facets[k]?.find((o) => o.value === v)?.label ?? v;
  const names = (k: MultiFilterKey, vals: string[]) => {
    const ls = vals.map((v) => label(k, v));
    return ls.length <= 2 ? ls.join(", ") : `${ls[0]} +${ls.length - 1}`;
  };
  for (const f of MULTI_FILTERS) if (q[f.key].length) chips.push({ key: f.key, text: `${f.key === "agent" ? "Sold by" : f.label}: ${names(f.key, q[f.key])}`, clear: { [f.key]: [] } as Partial<PolicyQuery> });
  for (const k of ["sub", "eff"] as const) {
    const cur = q[k];
    if (!cur) continue;
    let what: string = DATES[k].presets.find(([id]) => id === cur)?.[1] ?? "";
    if (cur === "custom") {
      const from = k === "sub" ? q.subFrom : q.effFrom;
      const to = k === "sub" ? q.subTo : q.effTo;
      what = from && to ? `${dayShort(from)} – ${dayShort(to)}` : from ? `From ${dayShort(from)}` : to ? `Until ${dayShort(to)}` : "Pick the days";
    }
    chips.push({ key: k, text: `${DATES[k].label}: ${what}`, clear: { [k]: null, [`${k}From`]: "", [`${k}To`]: "" } as Partial<PolicyQuery> });
  }
  if (q.ss) chips.push({ key: "ss", text: `Social Security billing: ${q.ss === "yes" ? "Yes" : "No"}`, clear: { ss: null } });
  if (q.benef) chips.push({ key: "benef", text: q.benef === "yes" ? "Has beneficiaries" : "No beneficiaries", clear: { benef: null } });
  if (q.stale) chips.push({ key: "stale", text: "Needs attention", clear: { stale: false } });
  if (q.nonum) chips.push({ key: "nonum", text: "No policy number", clear: { nonum: false } });
  if (!chips.length) return null;
  return (
    <div className="pol-active" aria-label="Filters on">
      <span className="pol-active-l">
        <Icon name="filter" size={15} />
        Filtered
      </span>
      {chips.map((c) => (
        <span key={c.key} className="pol-chip">
          <span className="pol-chip-t">{c.text}</span>
          <button type="button" className="pol-chip-x" aria-label={`Remove the filter ${c.text}`} onClick={() => go(c.clear)}>
            <Icon name="close" size={13} />
          </button>
        </span>
      ))}
      <button type="button" className="link pol-clear-all" onClick={() => go(clearFilters(q))}>
        Clear all
      </button>
    </div>
  );
}

function Table({ p, cols, words, onSort }: { p: PoliciesViewProps; cols: typeof POLICY_COLUMNS; words: string[]; onSort: (c: PolicyColumn) => void }) {
  const router = useRouter();
  const sort = p.query.sort;
  const cell = (c: PolicyColumn, r: PolicyRowView): ReactNode => {
    switch (c) {
      case "client":
        return (
          <>
            <div className="pol-cl">
              <Link href={`/policies/${r.id}`} className="pol-cl-name">
                {hl(r.client || "No client yet", words)}
              </Link>
              {r.fresh && <span className="pill pill-accent sm pol-new">Just logged</span>}
            </div>
            {r.isImport && <div className="pol-cl-sub">{policiesWord(r.policies)}</div>}
          </>
        );
      case "agent":
        return (
          <span className="pol-agent" title={r.agentName}>
            {hl(shortName(r.agentName), words)}
          </span>
        );
      case "carrier":
        return r.carrier || <span className="dim">—</span>;
      case "product":
        return r.product || <span className="dim">—</span>;
      case "monthly":
        return r.monthlyCents ? centsText(r.monthlyCents) : <span className="dim">—</span>;
      case "annual":
        return formatDollars(r.premiumCents);
      case "coverage":
        return r.coverageCents ? formatDollars(r.coverageCents) : <span className="dim">—</span>;
      case "status":
        if (r.isImport) return <span className="dim">—</span>;
        return (
          <>
            <StatusPill status={r.status} small />
            {r.staleDays > 0 && (
              <div className="pol-stale" title="Submitted or in underwriting for more than 5 days">
                <Icon name="clock" size={12} />
                {r.staleDays} days waiting
              </div>
            )}
          </>
        );
      case "submitted":
        return dayShort(r.soldOn);
      case "effective":
        return r.effectiveDate ? dayShort(r.effectiveDate) : <span className="dim">—</span>;
      case "lead":
        return r.leadSource || <span className="dim">—</span>;
      case "numbers":
        if (r.isImport) return <span className="dim">—</span>;
        return (
          <>
            <div className={cn("pol-num", !r.policyNumber && "none")}>{r.policyNumber ? hl(r.policyNumber, words) : "No policy # yet"}</div>
            <div className="pol-num-sub">{r.applicationNumber ? <>App {hl(r.applicationNumber, words)}</> : "No app #"}</div>
          </>
        );
    }
  };
  const NUMERIC = new Set<PolicyColumn>(["submitted", "effective", "numbers"]);
  return (
    <div className="tbl-wrap pol-tblbox">
      <table className="tbl pol-tbl" aria-label="Policies">
        <thead>
          <tr>
            {cols.map((c) => {
              const on = sort.by === c.id;
              return (
                <th key={c.id} scope="col" className={cn(`pol-th-${c.id}`, c.right && "r", on && "is-sorted")} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" className="th-btn" title={`Sort by ${c.label}`} onClick={() => onSort(c.id)}>
                    <span>{c.label}</span>
                    {on ? <Icon name={sort.dir === "asc" ? "sort-up" : "sort-down"} size={14} className="sort-on" /> : <Icon name="sort" size={13} className="pol-sort-idle" />}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r) => (
            <tr
              key={r.id}
              className="is-action"
              tabIndex={0}
              data-policy={r.id}
              onClick={(e) => !(e.target as HTMLElement).closest("a,button") && router.push(`/policies/${r.id}`)}
              onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && router.push(`/policies/${r.id}`)}
            >
              {cols.map((c) => (
                <td key={c.id} className={cn(`pol-td-${c.id}`, c.right ? "r num" : NUMERIC.has(c.id) && "num")}>
                  {cell(c.id, r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The phone's filter sheet: Sort, the views and every filter as toggle chips. */
function FilterSheet({ p, go, onClose }: { p: PoliciesViewProps; go: Go; onClose: () => void }) {
  const q = p.query;
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  const tog = (on: boolean, label: string, n: number | null, act: () => void, k?: string) => (
    <button key={k ?? label} type="button" className={cn("pol-tg", on && "on", n === 0 && !on && "zero")} aria-pressed={on} onClick={act}>
      {on && <Icon name="check" size={14} />}
      <span>{label}</span>
      {n != null && <span className="pol-tg-n num">{n}</span>}
    </button>
  );
  const group = (title: string, body: ReactNode, on: boolean, clear: Partial<PolicyQuery>) => (
    <section className="pol-sg" key={title}>
      <div className="pol-sg-head">
        <h3 className="pol-sg-title">{title}</h3>
        {on && (
          <button type="button" className="link" onClick={() => go(clear)}>
            Clear
          </button>
        )}
      </div>
      <div className="pol-sg-chips">{body}</div>
    </section>
  );
  const sortVal = `${q.sort.by}:${q.sort.dir}`;
  const choices = SORT_CHOICES.filter(([v]) => !v.startsWith("agent") || p.withAgent);
  if (!choices.some(([v]) => v === sortVal)) choices.unshift([sortVal, `${POLICY_COLUMNS.find((c) => c.id === q.sort.by)?.label ?? "Sorted"}, ${q.sort.dir === "asc" ? "A to Z" : "Z to A"}`]);
  const view = viewOf(q);
  const tri = (k: "ss" | "benef", title: string, yes: string, no: string) =>
    group(
      title,
      <>
        {tog(!q[k], "Any", null, () => go({ [k]: null } as Partial<PolicyQuery>))}
        {tog(q[k] === "yes", yes, p.yesNo[k].yes, () => go({ [k]: "yes" } as Partial<PolicyQuery>))}
        {tog(q[k] === "no", no, p.yesNo[k].pool - p.yesNo[k].yes, () => go({ [k]: "no" } as Partial<PolicyQuery>))}
      </>,
      !!q[k],
      { [k]: null } as Partial<PolicyQuery>,
    );
  const n = p.matched;
  return (
    <div className="ov-wrap" data-sheet>
      <div className="ov-scrim" onClick={onClose} />
      <div className="sheet full" role="dialog" aria-modal="true" aria-label="Filters and sort">
        <div className="sheet-grab" />
        <div className="sheet-head">
          <h2 className="sheet-title">Filters and sort</h2>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="sheet-body">
          <section className="pol-sg">
            <div className="field">
              <label className="field-label" htmlFor="pol-sort-sel">
                Sort
              </label>
              <div className="select-wrap">
                <select
                  id="pol-sort-sel"
                  className="select"
                  value={sortVal}
                  onChange={(e) => {
                    const [by, dir] = e.target.value.split(":");
                    const col = POLICY_COLUMNS.find((c) => c.id === by);
                    go({ sort: col ? { by: col.id, dir: dir === "asc" ? "asc" : "desc" } : DEFAULT_SORT }, true);
                  }}
                >
                  {choices.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <span className="select-chev" aria-hidden>
                  <Icon name="chevron-down" size={16} />
                </span>
              </div>
            </div>
          </section>
          {group(
            "Views",
            SAVED_VIEWS.filter((v) => v.id !== "all").map((v) => tog(view === v.id, v.label, p.views[v.id] ?? 0, () => go(viewQuery(view === v.id ? "all" : v.id, q)), v.id)),
            false,
            {},
          )}
          {MULTI_FILTERS.filter((f) => !f.team || p.withAgent).map((f) =>
            group(
              f.key === "agent" ? "Sold by" : f.label,
              (p.facets[f.key] ?? []).map((o) => tog(q[f.key].includes(o.value), o.label, o.n, () => go({ [f.key]: q[f.key].includes(o.value) ? q[f.key].filter((x) => x !== o.value) : [...q[f.key], o.value] } as Partial<PolicyQuery>), o.value)),
              q[f.key].length > 0,
              { [f.key]: [] } as Partial<PolicyQuery>,
            ),
          )}
          {(["sub", "eff"] as const).map((k) =>
            group(
              DATES[k].label,
              <>
                {DATES[k].presets.map(([id, label]) => tog(q[k] === id, label, null, () => go({ [k]: q[k] === id ? null : id } as Partial<PolicyQuery>), id))}
                {q[k] === "custom" && (
                  <div className="pol-pf-range">
                    <div className="field">
                      <label className="field-label" htmlFor={`pols-${k}-from`}>
                        From
                      </label>
                      <input id={`pols-${k}-from`} type="date" className="input" value={k === "sub" ? q.subFrom : q.effFrom} onChange={(e) => go({ [`${k}From`]: e.target.value } as Partial<PolicyQuery>)} />
                    </div>
                    <div className="field">
                      <label className="field-label" htmlFor={`pols-${k}-to`}>
                        To
                      </label>
                      <input id={`pols-${k}-to`} type="date" className="input" value={k === "sub" ? q.subTo : q.effTo} onChange={(e) => go({ [`${k}To`]: e.target.value } as Partial<PolicyQuery>)} />
                    </div>
                  </div>
                )}
              </>,
              !!q[k],
              { [k]: null, [`${k}From`]: "", [`${k}To`]: "" } as Partial<PolicyQuery>,
            ),
          )}
          {tri("ss", "Social Security billing", "Yes", "No")}
          {tri("benef", "Beneficiaries", "Has some", "None")}
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn btn-secondary" disabled={!activeCount(q)} onClick={() => go(clearFilters(q))}>
            Clear all
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {n ? `Show ${n} ${n === 1 ? "policy" : "policies"}` : "No policies match"}
          </button>
        </div>
      </div>
    </div>
  );
}

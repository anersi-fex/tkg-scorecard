import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "@/components/policy/policy.css";
import { pageViewer } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { getPolicyFor, loadRuleContext, policyHistory } from "@/lib/policies";
import { IMPORT_LABEL, LOCK_MINUTES } from "@/lib/policy-types";
import { canChangeStatus, canUsePolicies, clientSeers, editRights, logForChoices, nav, removeRights } from "@/lib/rules";
import { isAdmin } from "@/lib/viewer";
import { todayInDetroit } from "@/lib/month";
import { OwnSignIn } from "@/components/policy/own-sign-in";
import { clockTime, firstName, listWords, stamp } from "@/components/policy/format";
import { PolicyRecordView } from "./policy-record";

export const metadata: Metadata = { title: "Policy" };

/**
 * One policy (the demo's policy page): the head with its status, the sections (Policy, Client,
 * Beneficiaries, Notes) each with Edit and the locks the rules give (rules.ts editRights), the
 * history newest first, Take it back or Remove (removeRights). A policy the viewer may not see is
 * a 404, the same as one that is not there (policies.ts getPolicyFor). An AgentSpace day total
 * shows its total and nothing to edit.
 */
export default async function PolicyPage({ params, searchParams }: PageProps<"/policies/[id]">) {
  const viewer = await pageViewer();
  if (!canUsePolicies(viewer)) return <OwnSignIn title="Policy" />;
  const { id } = await params;
  const sp = await searchParams;
  const p = await getPolicyFor(viewer, id);
  if (!p) notFound();
  const [ctx, history, settings] = await Promise.all([loadRuleContext(), policyHistory(viewer, id), getSettings()]);
  const rights = editRights(viewer, p, ctx);
  const remove = removeRights(viewer, p, ctx);
  const statusOk = canChangeStatus(viewer, p, ctx);
  const seers = clientSeers(p, ctx);
  const names = (xs: { name: string }[]) => listWords(xs.map((a) => firstName(a.name)));
  const parts: string[] = [];
  if (seers.seller) parts.push(firstName(seers.seller.name));
  if (seers.uplines.length) parts.push(`the ${seers.uplines.length === 1 ? "upline" : "uplines"} above (${names(seers.uplines)})`);
  if (seers.admins.length) parts.push(`${seers.seller && (seers.seller.role === "admin" || seers.seller.role === "owner") ? "the other" : "the"} ${seers.admins.length === 1 ? "admin" : "admins"} (${names(seers.admins)})`);
  const seen = `Seen only by ${parts.length ? listWords(parts) : "nobody on the board"}. Never on the TV.`;
  const logger = p.loggedByAgent ? ctx.byId.get(p.loggedByAgent) : null;
  const until = Date.parse(p.createdAt) + LOCK_MINUTES * 60_000;
  const mine = !!viewer.agentId && (p.agentId === viewer.agentId || p.loggedByAgent === viewer.agentId);
  const fresh = until > ctx.nowMs && mine && !isAdmin(viewer);
  const policiesLabel = nav(viewer).items.find((i) => i.id === "policies")?.label ?? "Policies";
  const back = sp.back === "home" ? { href: "/", label: "Home" } : { href: "/policies", label: policiesLabel };
  // A person by first name; a shared password, the Shortcut or someone gone as the history says it.
  const byWho = (n: string) => (/password$|^Shortcut$|^Someone$/.test(n) ? n : firstName(n));
  return (
    <PolicyRecordView
      key={`${p.id}-${p.updatedAt ?? p.createdAt}`}
      policy={p}
      title={p.source === "import" ? IMPORT_LABEL : `${p.client.firstName} ${p.client.lastName}`.trim() || "No client yet"}
      back={back}
      loggedLine={`Logged ${stamp(p.createdAt)}${logger && logger.id !== p.agentId ? ` by ${logger.name}` : ""}`}
      freshLine={fresh ? `Just logged: you can fix anything or take it back until ${clockTime(until)}.` : null}
      rights={{ fields: [...rights.fields], locked: rights.locked, asksOwner: rights.asksOwner }}
      statusOk={statusOk}
      statusLock={rights.locked.status ?? "You can't change this status."}
      remove={remove}
      soldByChoices={isAdmin(viewer) ? logForChoices(viewer, ctx).map((a) => ({ id: a.id, name: a.name })) : []}
      lists={{ carrierProducts: settings.carrierProducts, rateClasses: settings.rateClasses, leadSources: settings.leadSources }}
      today={todayInDetroit()}
      seen={seen}
      history={history.map((h) => ({ key: h.id, what: h.what, meta: `by ${byWho(h.byName)} · ${stamp(h.at)}` }))}
      startEdit={sp.edit === "policy" && rights.fields.size > 0 ? "policy" : null}
    />
  );
}

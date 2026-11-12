"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth";
import { isOwner } from "@/lib/viewer";
import { addAgent, lineFor, listAgents, touchBoard, updateAgent } from "@/lib/data";
import { cleanName, sameName, setInOffice, setUpline } from "@/lib/people";
import type { ActionResult } from "../actions";

// Any id Postgres holds (the same shape src/lib/people.ts accepts).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * People > Add a person (owner, 2026-11-12): a name, whose team they are on and whether they
 * work in the office, in one step. The owner or an admin, checked here on the server. Someone
 * who was taken off the board comes back instead of being added twice.
 */
export async function addPersonToTeam(form: FormData): Promise<ActionResult> {
  try {
    const viewer = await requireViewer("admin");
    const name = cleanName(form.get("name"));
    if (!name) return { ok: false, error: "Type the person's first and last name." };
    const rawUpline = String(form.get("upline_id") ?? "").trim();
    const uplineId = rawUpline ? rawUpline : null;
    if (uplineId !== null && !UUID.test(uplineId)) return { ok: false, error: "Pick the upline again." };
    const inOffice = String(form.get("in_office") ?? "") === "1";
    const existing = await listAgents({ includeInactive: true });
    if (uplineId && !existing.some((a) => a.id === uplineId && a.active)) return { ok: false, error: "That upline isn't on the board." };
    // The same person however the name was typed (case, spaces, the kind of apostrophe); someone on the board first.
    const same = existing.filter((a) => sameName(a.name, name));
    const dup = same.find((a) => a.active) ?? same[0];
    if (dup?.active) return { ok: false, error: `${dup.name} is already on the board.` };
    let id: string;
    if (dup) {
      // Back on the board brings an old sign-in back with it: for someone who was an admin that is the owner's call.
      if (!isOwner(viewer) && (dup.role === "admin" || dup.role === "owner")) return { ok: false, error: `${dup.name} was an admin. Only the owner can put them back.` };
      await updateAgent(dup.id, { active: true });
      id = dup.id;
    } else {
      id = (await addAgent(name)).id;
    }
    // The person is on the board from here on; a team or office mark that does not save is said plainly.
    let note = "";
    try {
      if (uplineId && uplineId !== id) await setUpline(id, uplineId);
      await setInOffice(id, inOffice);
    } catch (err) {
      // The line the code wrote ("That upline isn't on the board."), never the database's own words.
      note = ` ${lineFor(err, "Their team did not save.")} Open them to set it.`;
    }
    revalidatePath("/", "layout");
    // The TV is told, so the new person shows within one poll.
    await touchBoard();
    return { ok: true, id, message: `${dup ? `${dup.name} is back on the board.` : `${name} is on the board.`}${note}` };
  } catch (err) {
    return { ok: false, error: lineFor(err) };
  }
}
